/**
 * Orchestrator — ensures assets are fresh for requested segments, then renders.
 *
 *   tsx pipeline/build.ts --segment 02-what-is-ai-photoshoot
 *   tsx pipeline/build.ts --all
 *
 * Tier precedence (picked from env vars + segment config):
 *
 *   WAVESPEED + avatar.image_url   Inworld TTS → OmniHuman lipsync to that image   (BEST)
 *   WAVESPEED only                 Inworld TTS + placeholder avatar frame          (voice-only)
 *   HEYGEN only                    HeyGen Avatar IV (stock avatar + voice)         (fallback)
 *   neither                        macOS `say` + placeholder                       (minimum)
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import "dotenv/config";

import { generateInworldAudio } from "./generate-tts.js";
import { generateOmniHuman } from "./generate-omnihuman.js";
import { generateInfiniteTalk } from "./generate-infinitetalk.js";
import { generateAvatar } from "./generate-avatar.js";
import { recordScreencast } from "./record-screencast.js";
import {
  buildCaptionBeats,
  DRAFT_CAPTIONS_CSS,
  draftDurationSec,
  ensureSilentNarration,
  renderCaptionsHtml,
} from "./draft-helpers.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

interface SegmentYaml {
  id: string;
  title: string;
  narration: string;
  visual: "presenter-slide" | "screencast-pip";
  slide?: {
    eyebrow?: string;
    title_html?: string;
    bullets?: string[];
  };
  screencast?: {
    mode?: "video" | "image";
    src?: string;                // image path (for mode=image)
    url?: string;                // browser URL bar text
    record_script?: string;      // path to scripts/record/<id>.ts (for mode=video)
    fallback_image?: string;     // used if the recording fails
  };
  caption?: { eyebrow?: string; html?: string };
  avatar?: {
    image_url?: string;
    engine?: "omnihuman" | "infinitetalk";
    resolution?: "480p" | "720p";
  };
}
interface WebinarYaml {
  segments: string[];
}

const loadWebinar = () => yaml.load(readFileSync(join(ROOT, "script", "webinar.yaml"), "utf-8")) as WebinarYaml;
const loadSegment = (id: string) =>
  yaml.load(readFileSync(join(ROOT, "script", "segments", `${id}.yaml`), "utf-8")) as SegmentYaml;

function run(cmd: string, args: string[], cwd = ROOT) {
  const r = spawnSync(cmd, args, { cwd, stdio: "inherit" });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} exited with ${r.status}`);
}

function ffprobeDuration(file: string): number {
  const r = spawnSync(
    "ffprobe",
    ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file],
    { encoding: "utf-8" }
  );
  if (r.status !== 0) throw new Error(`ffprobe failed on ${file}`);
  return parseFloat(r.stdout.trim());
}

function sanitizeForSay(text: string) {
  return text.replace(/[—–]/g, " - ").replace(/["']/g, "").replace(/\s+/g, " ").trim();
}

function ensureSayNarration(segmentId: string, narration: string) {
  const audioDir = join(ROOT, "assets", "audio");
  mkdirSync(audioDir, { recursive: true });
  const aiff = join(audioDir, `${segmentId}.aiff`);
  const mp3 = join(audioDir, `${segmentId}.mp3`);
  const segFile = join(ROOT, "script", "segments", `${segmentId}.yaml`);
  const stale = !existsSync(mp3) || statSync(segFile).mtimeMs > statSync(mp3).mtimeMs;
  if (!stale) {
    console.log(`[say] ${segmentId}: narration cached`);
    return mp3;
  }
  console.log(`[say] ${segmentId}: running macOS say`);
  run("say", ["-v", "Daniel", "-r", "175", "-o", aiff, sanitizeForSay(narration)]);
  run("ffmpeg", ["-y", "-i", aiff, "-c:a", "libmp3lame", "-q:a", "2", mp3]);
  return mp3;
}

function pickScreencastMedia(segment: SegmentYaml): string | undefined {
  const s = segment.screencast;
  if (!s) return undefined;
  const recordedMp4 = join("assets", "captures", `${segment.id}.mp4`);
  const absMp4 = join(ROOT, recordedMp4);
  if (s.mode === "video" && existsSync(absMp4)) return recordedMp4;
  return s.src ?? s.fallback_image;
}

function avatarMediaHtml(segmentId: string, hasAvatar: boolean) {
  if (hasAvatar) {
    return `<video muted playsinline src="assets/avatars/${segmentId}.mp4" style="width:100%;height:100%;object-fit:cover;display:block;"></video>`;
  }
  return `<div class="avatar-placeholder">
          <div class="avatar-ring"></div>
          <div class="avatar-label">PRESENTER<br/><span>Alon · Astria</span></div>
        </div>`;
}

function renderLayout(segment: SegmentYaml, hasAvatar: boolean, audioSrc: string, durationSec: number) {
  const layoutPath = join(ROOT, "layouts", `${segment.visual}.html`);
  let html = readFileSync(layoutPath, "utf-8");

  const draftMode = process.env.DRAFT === "1";
  // In draft mode, inject burn-in captions so the segment is watchable without narration.
  let captionsCss = "";
  let captionsHtml = "";
  let captionsGsap = "";
  if (draftMode && segment.narration) {
    const beats = buildCaptionBeats(segment.narration, durationSec);
    const rendered = renderCaptionsHtml(beats);
    captionsCss = DRAFT_CAPTIONS_CSS;
    captionsHtml = rendered.html;
    captionsGsap = rendered.gsap;
  }

  const vars: Record<string, string> = {
    DURATION: durationSec.toFixed(2),
    AUDIO_SRC: audioSrc,
    AVATAR_MEDIA: avatarMediaHtml(segment.id, hasAvatar),
    CAPTIONS_CSS: captionsCss,
    CAPTIONS_HTML: captionsHtml,
    CAPTIONS_GSAP: captionsGsap,
  };

  if (segment.visual === "presenter-slide") {
    const bullets = (segment.slide?.bullets ?? []).map((b) => `<li>${b}</li>`).join("\n            ");
    vars.SLIDE_EYEBROW = segment.slide?.eyebrow ?? "";
    vars.SLIDE_TITLE_HTML = segment.slide?.title_html ?? segment.title;
    vars.SLIDE_BULLETS_HTML = bullets;
  } else if (segment.visual === "screencast-pip") {
    const screencastMediaPath = pickScreencastMedia(segment);
    if (screencastMediaPath?.endsWith(".mp4")) {
      vars.SCREENCAST_MEDIA = `<video id="seg-screencast" muted playsinline autoplay src="${screencastMediaPath}"></video>`;
    } else {
      vars.SCREENCAST_MEDIA = `<img id="seg-screenshot" src="${screencastMediaPath ?? ""}" alt="" />`;
    }
    vars.BROWSER_URL = segment.screencast?.url ?? "astria.ai";
    vars.CAPTION_EYEBROW = segment.caption?.eyebrow ?? "";
    vars.CAPTION_HTML = segment.caption?.html ?? "";
  }

  for (const [k, v] of Object.entries(vars)) {
    html = html.replaceAll(`{{${k}}}`, v);
  }

  writeFileSync(join(ROOT, "index.html"), html);
}

async function buildOne(segmentId: string) {
  const segment = loadSegment(segmentId);
  const draftMode = process.env.DRAFT === "1";
  const hasWave = !draftMode && Boolean(process.env.WAVESPEED_API_KEY);
  const hasHeygen = !draftMode && Boolean(process.env.HEYGEN_API_KEY);
  const imageUrl = segment.avatar?.image_url;

  const engine = segment.avatar?.engine ?? "omnihuman";
  const resolution = segment.avatar?.resolution ?? "480p";

  const tier = draftMode
    ? "draft"
    : hasWave && imageUrl
    ? `inworld+${engine}`
    : hasWave
    ? "inworld"
    : hasHeygen
    ? "heygen"
    : "say";

  console.log(`\n=== ${segmentId} — tier: ${tier} ===`);

  let audioMp3: string;
  let audioUrl: string | null = null;
  let avatarMp4: string | null = null;

  if (draftMode) {
    // No paid APIs: silent audio sized from narration word count.
    const duration = draftDurationSec(segment.narration);
    audioMp3 = ensureSilentNarration(ROOT, segmentId, duration);
    console.log(`[draft] ${segmentId}: silent audio ${duration.toFixed(1)}s`);
  } else if (hasWave) {
    const inw = await generateInworldAudio(segmentId);
    audioMp3 = inw.localPath;
    audioUrl = inw.url;
  } else if (hasHeygen) {
    audioMp3 = join(ROOT, "assets", "audio", `${segmentId}.mp3`);
  } else {
    audioMp3 = ensureSayNarration(segmentId, segment.narration);
  }

  if (hasWave && imageUrl) {
    if (engine === "infinitetalk") {
      avatarMp4 = await generateInfiniteTalk(segmentId, audioUrl!, imageUrl, resolution);
    } else {
      avatarMp4 = await generateOmniHuman(segmentId, audioUrl!, imageUrl);
    }
  } else if (tier === "heygen") {
    avatarMp4 = await generateAvatar(segmentId);
    run("ffmpeg", ["-y", "-i", avatarMp4, "-vn", "-acodec", "libmp3lame", "-q:a", "2", audioMp3]);
  }

  const sourceForDuration = avatarMp4 ?? audioMp3;
  const safeDuration = Math.ceil(ffprobeDuration(sourceForDuration) * 10) / 10 + 0.2;

  // Screencast recording: only for screencast-pip segments with mode=video.
  // Skipped when the mp4 already exists (cheap iteration) unless --rerecord is passed.
  if (segment.visual === "screencast-pip" && segment.screencast?.mode === "video") {
    const mp4 = join(ROOT, "assets", "captures", `${segmentId}.mp4`);
    const rerecord = process.argv.includes("--rerecord");
    if (!existsSync(mp4) || rerecord) {
      await recordScreencast(segmentId);
    } else {
      console.log(`[record] ${segmentId}: using cached ${mp4} (pass --rerecord to refresh)`);
    }
  }

  const audioSrc = `assets/audio/${segmentId}.mp3`;
  renderLayout(segment, Boolean(avatarMp4), audioSrc, safeDuration);
  console.log(`[build] ${segmentId}: visual=${segment.visual} duration=${safeDuration.toFixed(2)}s`);
}

async function main() {
  const idx = process.argv.indexOf("--segment");
  const all = process.argv.includes("--all");
  if (idx === -1 && !all) {
    console.error("Usage: tsx pipeline/build.ts --segment <id> | --all");
    process.exit(1);
  }

  const targets = all ? loadWebinar().segments : [process.argv[idx + 1]];
  for (const id of targets) await buildOne(id);

  console.log("\n[build] running hyperframes lint…");
  run("npx", ["hyperframes", "lint"]);

  const output = `out/${targets.length === 1 ? targets[0] : "webinar"}.mp4`;
  mkdirSync(join(ROOT, "out"), { recursive: true });
  console.log(`[build] rendering → ${output}`);
  // --workers 2 avoids the Target.setAutoAttach timeout we hit with the default 8 workers
  // on compositions that embed an avatar MP4 with sparse keyframes.
  run("npx", ["hyperframes", "render", "--output", output, "--quality", "draft", "--workers", "2"]);
  console.log(`[build] done → ${join(ROOT, output)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
