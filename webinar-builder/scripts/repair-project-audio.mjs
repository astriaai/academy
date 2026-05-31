#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));

function argValue(name, fallback) {
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? process.argv[idx + 1] : fallback;
}

function run(cmd, args, options = {}) {
  const r = spawnSync(cmd, args, { stdio: options.stdio ?? "inherit", encoding: "utf-8" });
  if (r.status !== 0) {
    throw new Error(`${cmd} failed${r.stderr ? `: ${r.stderr}` : ""}`);
  }
  return r;
}

function ffprobeDuration(file) {
  const r = run(
    "ffprobe",
    ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file],
    { stdio: "pipe" },
  );
  const duration = Number.parseFloat(r.stdout.trim());
  if (!Number.isFinite(duration)) throw new Error(`Could not read duration: ${file}`);
  return duration;
}

function loadYaml(path) {
  return yaml.load(readFileSync(path, "utf-8"));
}

function repairSegmentAudio(project, id) {
  const segmentPath = join(ROOT, "script", "segments", project, `${id}.yaml`);
  const segment = loadYaml(segmentPath);
  const videoPath = join(ROOT, "out", project, `${id}.mp4`);
  const audioPath = join(ROOT, "assets", "audio", project, `${id}.mp3`);
  if (!existsSync(videoPath)) throw new Error(`Missing segment video: ${videoPath}`);
  if (!existsSync(audioPath)) throw new Error(`Missing narration audio: ${audioPath}`);

  const duration = ffprobeDuration(videoPath);
  const tmp = videoPath.replace(/\.mp4$/, ".clean-audio.mp4");
  const inputs = ["-i", videoPath, "-i", audioPath];
  const filters = [`[1:a]aresample=48000,volume=${segment.narration_volume ?? 1}[a0]`];
  const labels = ["[a0]"];

  for (const [index, item] of (segment.sfx ?? []).entries()) {
    const src = join(ROOT, item.src);
    if (!existsSync(src)) throw new Error(`Missing SFX: ${src}`);
    inputs.push("-i", src);
    const inputIndex = index + 2;
    const delayMs = Math.max(0, Math.round(Number(item.start ?? 0) * 1000));
    const volume = Number(item.volume ?? 0.6);
    const label = `[a${index + 1}]`;
    filters.push(
      `[${inputIndex}:a]aresample=48000,volume=${volume},adelay=${delayMs}|${delayMs}${label}`,
    );
    labels.push(label);
  }

  const filter = [
    ...filters,
    `${labels.join("")}amix=inputs=${labels.length}:duration=longest:dropout_transition=0,` +
      `apad,atrim=0:${duration.toFixed(3)},asetpts=N/SR/TB[aout]`,
  ].join(";");

  run("ffmpeg", [
    "-y",
    ...inputs,
    "-filter_complex", filter,
    "-map", "0:v",
    "-map", "[aout]",
    "-c:v", "copy",
    "-c:a", "aac",
    "-b:a", "192k",
    "-movflags", "+faststart",
    tmp,
  ]);
  renameSync(tmp, videoPath);
  console.log(`[repair-audio] ${id}: replaced segment audio`);
}

function stitchWithXfade(project, segmentIds, fadeDur) {
  const clips = segmentIds.map((id) => join(ROOT, "out", project, `${id}.mp4`));
  const durations = clips.map(ffprobeDuration);
  const inputs = clips.flatMap((clip) => ["-i", clip]);
  const outPath = join(ROOT, "out", project, "_full-draft.mp4");
  mkdirSync(dirname(outPath), { recursive: true });

  let vLabel = "[0:v]";
  let aLabel = "[0:a]";
  let acc = durations[0];
  const filters = [];
  for (let i = 1; i < clips.length; i += 1) {
    const offset = acc - fadeDur;
    const nextV = `[v${String(i).padStart(2, "0")}]`;
    const nextA = `[a${String(i).padStart(2, "0")}]`;
    filters.push(`${vLabel}[${i}:v]xfade=transition=fade:duration=${fadeDur}:offset=${offset.toFixed(3)}${nextV}`);
    filters.push(`${aLabel}[${i}:a]acrossfade=d=${fadeDur}:c1=tri:c2=tri${nextA}`);
    vLabel = nextV;
    aLabel = nextA;
    acc += durations[i] - fadeDur;
  }

  run("ffmpeg", [
    "-y",
    ...inputs,
    "-filter_complex", filters.join(";"),
    "-map", vLabel,
    "-map", aLabel,
    "-c:v", "libx264",
    "-pix_fmt", "yuv420p",
    "-profile:v", "high",
    "-level", "4.0",
    "-crf", "22",
    "-preset", "fast",
    "-c:a", "aac",
    "-b:a", "128k",
    "-movflags", "+faststart",
    outPath,
  ]);
  return outPath;
}

function mixMusic(stitched, musicPath, volume) {
  if (!existsSync(musicPath)) throw new Error(`Missing music bed: ${musicPath}`);
  const duration = ffprobeDuration(stitched);
  const fadeOut = Math.max(0, duration - 1.8);
  const tmp = stitched.replace(/\.mp4$/, ".pre-music.mp4");
  renameSync(stitched, tmp);
  const filter = [
    `[1:a]volume=${volume.toFixed(2)},afade=t=in:st=0:d=1.0,afade=t=out:st=${fadeOut.toFixed(2)}:d=1.8[music]`,
    `[music][0:a]sidechaincompress=threshold=0.03:ratio=14:attack=8:release=450[music_ducked]`,
    `[music_ducked][0:a]amix=inputs=2:duration=longest:weights=0.65 4.5,dynaudnorm=f=150:g=9[mix]`,
  ].join(";");
  run("ffmpeg", [
    "-y",
    "-i", tmp,
    "-i", musicPath,
    "-filter_complex", filter,
    "-map", "0:v",
    "-map", "[mix]",
    "-c:v", "copy",
    "-c:a", "aac",
    "-b:a", "192k",
    "-movflags", "+faststart",
    stitched,
  ]);
  try {
    unlinkSync(tmp);
  } catch {}
}

function copyVersioned(project, file) {
  const bytes = readFileSync(file);
  const hash = run(
    "shasum",
    ["-a", "256", file],
    { stdio: "pipe" },
  ).stdout.trim().split(/\s+/)[0].slice(0, 8);
  const versioned = file.replace(/\.mp4$/, `.${hash}.mp4`);
  if (versioned !== file) {
    const tmp = `${versioned}.tmp`;
    writeFileSync(tmp, bytes);
    renameSync(tmp, versioned);
  }
  console.log(`[repair-audio] ${project}: ${file} hash=${hash}`);
}

function updateLocalManifest(project, segmentIds) {
  const manifestPath = join(ROOT, "site", "manifest.json");
  if (!existsSync(manifestPath)) return;
  const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
  const entry = manifest.projects?.find((item) => item.id === project);
  if (!entry) return;
  entry.fullDraftUrl = `videos/${project}/_full-draft.mp4`;
  for (const segment of entry.segments ?? []) {
    if (segmentIds.includes(segment.id)) {
      segment.videoUrl = `videos/${project}/${segment.id}.mp4`;
    }
  }
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`[repair-audio] ${project}: updated site/manifest.json to unversioned repaired MP4s`);
}

function main() {
  const project = argValue("--project", "face-inpainting");
  const fade = Number.parseFloat(argValue("--fade", "0.4"));
  const projectCfg = loadYaml(join(ROOT, "script", "projects", `${project}.yaml`));
  const segments = projectCfg.segments ?? [];
  if (!segments.length) throw new Error(`No segments in project ${project}`);

  for (const id of segments) repairSegmentAudio(project, id);
  const stitched = stitchWithXfade(project, segments, fade);

  const music = projectCfg.defaults?.music;
  if (music?.mix_at_stitch && music.src) {
    mixMusic(stitched, join(ROOT, music.src), Number(music.volume ?? 0.55));
  }

  copyVersioned(project, stitched);
  updateLocalManifest(project, segments);
  console.log(`[repair-audio] done: ${stitched} (${(statSync(stitched).size / 1048576).toFixed(1)} MB)`);
}

main();
