/**
 * Duration fixer for webinar-builder projects.
 *
 * By default this is a dry run. With --apply, it updates top-level YAML
 * duration values so rendered segments have enough room for current TTS/avatar
 * media plus TIMING_TAIL_PAD_SEC.
 *
 * Usage:
 *   tsx pipeline/timing-fix.ts --project artboard-2
 *   tsx pipeline/timing-fix.ts --project artboard-2 --apply
 *   tsx pipeline/timing-fix.ts --project artboard-2 --segments 03-create-studio-artboard,07-edit-moody-artboard --apply
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const TAIL_PAD_SEC = Number(process.env.TIMING_TAIL_PAD_SEC ?? "0.75");

type ProjectYaml = { segments: string[] };
type SegmentYaml = { narration?: string; duration?: number };

function argValue(name: string, fallback?: string): string | undefined {
  const idx = process.argv.indexOf(name);
  return idx === -1 ? fallback : process.argv[idx + 1];
}

function ffprobeDuration(file: string): number | null {
  if (!existsSync(file)) return null;
  const r = spawnSync(
    "ffprobe",
    ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file],
    { encoding: "utf-8" },
  );
  if (r.status !== 0) return null;
  const n = Number(r.stdout.trim());
  return Number.isFinite(n) ? n : null;
}

function loadYaml<T>(path: string): T {
  return yaml.load(readFileSync(path, "utf-8")) as T;
}

function roundedDuration(sec: number): number {
  return Math.ceil(sec * 10) / 10;
}

function writeDurationPreservingYaml(path: string, nextDuration: number) {
  const src = readFileSync(path, "utf-8");
  const line = `duration: ${nextDuration.toFixed(1)}`;
  if (/^duration:\s*.*$/m.test(src)) {
    writeFileSync(path, src.replace(/^duration:\s*.*$/m, line));
    return;
  }
  if (/^visual:\s*.*$/m.test(src)) {
    writeFileSync(path, src.replace(/^visual:\s*.*$/m, (m) => `${m}\n${line}`));
    return;
  }
  writeFileSync(path, `${line}\n${src}`);
}

function main() {
  const project = argValue("--project", "webinar")!;
  const apply = process.argv.includes("--apply");
  const segmentArg = argValue("--segments");
  const cfg = loadYaml<ProjectYaml>(join(ROOT, "script", "projects", `${project}.yaml`));
  const targetSet = segmentArg ? new Set(segmentArg.split(",").map((s) => s.trim()).filter(Boolean)) : null;
  const ids = targetSet ? cfg.segments.filter((id) => targetSet.has(id)) : cfg.segments;
  let changed = 0;

  for (const id of ids) {
    const segmentPath = join(ROOT, "script", "segments", project, `${id}.yaml`);
    const segment = loadYaml<SegmentYaml>(segmentPath);
    const isSilent = !segment.narration || segment.narration.trim() === "";
    if (isSilent) continue;

    const audio = ffprobeDuration(join(ROOT, "assets", "audio", project, `${id}.mp3`));
    const avatar = ffprobeDuration(join(ROOT, "assets", "avatars", project, `${id}.mp4`));
    const mediaDuration = Math.max(audio ?? 0, avatar ?? 0);
    if (!mediaDuration) {
      console.log(`[skip] ${id}: no audio/avatar cache yet`);
      continue;
    }

    const recommended = roundedDuration(mediaDuration + TAIL_PAD_SEC);
    const current = segment.duration;
    if (current !== undefined && current >= recommended) {
      console.log(`[ok]   ${id}: duration ${current.toFixed(1)}s >= recommended ${recommended.toFixed(1)}s`);
      continue;
    }

    const currentLabel = current === undefined ? "unset" : `${current.toFixed(1)}s`;
    console.log(`[fix]  ${id}: duration ${currentLabel} -> ${recommended.toFixed(1)}s`);
    changed++;
    if (apply) writeDurationPreservingYaml(segmentPath, recommended);
  }

  console.log(apply ? `[timing-fix] updated ${changed} segment(s)` : `[timing-fix] dry run, ${changed} change(s) available`);
}

main();
