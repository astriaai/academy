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

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import "dotenv/config";

import { generateInworldAudio } from "./generate-tts.js";
import { generateGeminiAudio } from "./generate-tts-gemini.js";
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
    bullet_starts?: number[];   // seconds; index-aligned with bullets for paced reveals
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
  defaults?: {
    tts?: { provider?: "inworld" | "gemini" };
  };
}

const loadWebinar = () => yaml.load(readFileSync(join(ROOT, "script", "webinar.yaml"), "utf-8")) as WebinarYaml;
const loadSegment = (id: string) =>
  yaml.load(readFileSync(join(ROOT, "script", "segments", `${id}.yaml`), "utf-8")) as SegmentYaml;

function run(cmd: string, args: string[], cwd = ROOT) {
  const r = spawnSync(cmd, args, { cwd, stdio: "inherit" });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} exited with ${r.status}`);
}

/**
 * Run `hyperframes render` but terminate the child as soon as it prints
 * "Render complete". The Node process hangs after the mp4 is fully written
 * (likely a Chromium worker cleanup bug in hyperframes 0.4.6); waiting for
 * a natural exit adds 30–90 s per build. By the time we see the completion
 * line the mp4 is flushed — a 1 s grace then SIGTERM is safe.
 */
function runRenderWithEarlyKill(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("npx", args, { cwd: ROOT });
    let completed = false;
    let killTimer: NodeJS.Timeout | null = null;
    const onData = (buf: Buffer) => {
      const s = buf.toString();
      process.stdout.write(s);
      if (!completed && s.includes("Render complete")) {
        completed = true;
        killTimer = setTimeout(() => {
          try { process.kill(child.pid!, "SIGTERM"); } catch {}
          setTimeout(() => { try { process.kill(child.pid!, "SIGKILL"); } catch {} }, 4000).unref();
        }, 1000);
      }
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", (b) => process.stderr.write(b));
    child.on("close", (code, signal) => {
      if (killTimer) clearTimeout(killTimer);
      if (completed || code === 0) return resolve();
      reject(new Error(`hyperframes render exited with code=${code} signal=${signal}`));
    });
    child.on("error", reject);
  });
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
    const bulletList = segment.slide?.bullets ?? [];
    const bulletStarts = segment.slide?.bullet_starts;
    const bullets = bulletList
      .map((b, i) => {
        const t = bulletStarts?.[i];
        const attr = typeof t === "number" ? ` data-start="${t.toFixed(2)}"` : "";
        return `<li${attr}>${b}</li>`;
      })
      .join("\n            ");
    vars.SLIDE_EYEBROW = segment.slide?.eyebrow ?? "";
    vars.SLIDE_TITLE_HTML = segment.slide?.title_html ?? segment.title;
    vars.SLIDE_BULLETS_HTML = bullets;
    // Automatic density: 6+ bullets trigger compact typography.
    vars.SLIDE_FRAME_CLASS = bulletList.length >= 6 ? "dense" : "";
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

let anySegmentHasAvatarMp4 = false;

async function buildOne(segmentId: string) {
  const segment = loadSegment(segmentId);
  const draftMode = process.env.DRAFT === "1";
  const hasWave = !draftMode && Boolean(process.env.WAVESPEED_API_KEY);
  const hasHeygen = !draftMode && Boolean(process.env.HEYGEN_API_KEY);
  const hasGemini = !draftMode && Boolean(process.env.VERTEX_API_KEY);
  const noAvatar = process.env.NO_AVATAR === "1";
  const imageUrl = noAvatar ? undefined : segment.avatar?.image_url;

  // Provider selection: TTS_PROVIDER env > webinar.yaml defaults.tts.provider > auto.
  // Gemini TTS has no hosted URL, so it skips OmniHuman/InfiniteTalk entirely.
  const webinarCfg = loadWebinar() as WebinarYaml;
  const providerPref = (process.env.TTS_PROVIDER ?? webinarCfg.defaults?.tts?.provider) as
    | "inworld"
    | "gemini"
    | undefined;
  const useGemini = providerPref === "gemini" && hasGemini;

  const engine = segment.avatar?.engine ?? "omnihuman";
  const resolution = segment.avatar?.resolution ?? "480p";

  const tier = draftMode
    ? "draft"
    : useGemini
    ? "gemini"
    : hasWave && imageUrl
    ? `inworld+${engine}`
    : hasWave
    ? "inworld"
    : hasHeygen && !noAvatar
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
  } else if (useGemini) {
    const g = await generateGeminiAudio(segmentId);
    audioMp3 = g.localPath;
    // Gemini TTS does not produce a hosted URL — avatar lipsync path is skipped.
  } else if (hasWave) {
    const inw = await generateInworldAudio(segmentId);
    audioMp3 = inw.localPath;
    audioUrl = inw.url;
  } else if (hasHeygen) {
    audioMp3 = join(ROOT, "assets", "audio", `${segmentId}.mp3`);
  } else {
    audioMp3 = ensureSayNarration(segmentId, segment.narration);
  }

  if (!useGemini && hasWave && imageUrl && audioUrl) {
    if (engine === "infinitetalk") {
      avatarMp4 = await generateInfiniteTalk(segmentId, audioUrl, imageUrl, resolution);
    } else {
      avatarMp4 = await generateOmniHuman(segmentId, audioUrl, imageUrl);
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
  if (avatarMp4) anySegmentHasAvatarMp4 = true;
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

  const output = `out/${targets.length === 1 ? targets[0] : "webinar"}.mp4`;
  mkdirSync(join(ROOT, "out"), { recursive: true });
  // Compositions that embed an avatar MP4 with sparse keyframes trip
  // Target.setAutoAttach at higher worker counts — keep those at 2. Slide-only
  // renders handle 4 workers cleanly and finish roughly twice as fast.
  const workers = process.env.HF_WORKERS ?? (anySegmentHasAvatarMp4 ? "2" : "4");
  console.log(`[build] rendering → ${output} (workers=${workers})`);
  // Render runs its own lint internally — no need for a separate pass.
  await runRenderWithEarlyKill([
    "hyperframes", "render",
    "--output", output,
    "--quality", "draft",
    "--workers", workers,
  ]);
  console.log(`[build] done → ${join(ROOT, output)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
