/**
 * Orchestrator — ensures assets are fresh for requested segments, then renders.
 *
 *   tsx pipeline/build.ts --segment 03-traditional-photoshoot
 *   tsx pipeline/build.ts --all
 *
 * Tier precedence (picked from env vars + segment config):
 *
 *   WAVESPEED + avatar.image_url   Inworld TTS → OmniHuman lipsync to that image   (BEST)
 *   WAVESPEED only                 Inworld TTS + placeholder avatar frame          (voice-only)
 *   HEYGEN only                    HeyGen Avatar IV (stock avatar + voice)         (fallback)
 *   neither                        macOS `say` + placeholder                       (minimum)
 *
 * Avatar engines (set per-segment via avatar.engine):
 *   omnihuman      ByteDance OmniHuman via WaveSpeed (default)
 *   infinitetalk   WaveSpeed InfiniteTalk
 *   pruna          Pruna AI p-video-avatar via Replicate (needs REPLICATE_API_TOKEN)
 */

import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  statSync,
  symlinkSync,
  lstatSync,
  unlinkSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import "dotenv/config";

import { generateInworldAudio } from "./generate-tts.js";
import { generateGeminiAudio } from "./generate-tts-gemini.js";
import { generateOmniHuman } from "./generate-omnihuman.js";
import { generateOmniHumanByteplus } from "./generate-omnihuman-byteplus.js";
import { generateInfiniteTalk } from "./generate-infinitetalk.js";
import { generatePruna } from "./generate-pruna.js";
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
  visual: "presenter-slide" | "screencast-pip" | "avatar-hero";
  slide?: {
    eyebrow?: string;
    title_html?: string;
    bullets?: string[];
    bullet_starts?: number[];   // seconds; index-aligned with bullets for paced reveals
    columns?: Array<{
      heading: string;
      bullets: string[];
      bullet_starts?: number[];
    }>;
  };
  screencast?: {
    mode?: "video" | "image";
    src?: string;                // image path (for mode=image)
    url?: string;                // browser URL bar text
    record_script?: string;      // path to scripts/record/<id>.ts (for mode=video)
    fallback_image?: string;     // used if the recording fails
  };
  caption?: {
    eyebrow?: string;
    html?: string;
    hide_at?: number;   // seconds; fades caption out at this time (optional)
  };
  avatar?: {
    image_url?: string;
    engine?:
      | "omnihuman"
      | "omnihuman-1.5"
      | "omnihuman-1.5-byteplus"
      | "infinitetalk"
      | "pruna";
    resolution?: "480p" | "720p" | "1080p";
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
 * Create a per-segment render directory at `.work/<segmentId>/` that mirrors
 * the project root via symlinks. Each segment gets its own `index.html` so
 * parallel builds can't race on a shared file. Read-only inputs (assets/,
 * hyperframes.json, meta.json) are symlinked; the composition HTML is
 * written per-segment.
 */
function ensureWorkDir(segmentId: string): string {
  const dir = join(ROOT, ".work", segmentId);
  mkdirSync(dir, { recursive: true });

  // Targets that need to resolve from the rendered HTML. Symlinks instead
  // of copies — assets are large and these are read-only.
  const links = ["assets", "hyperframes.json", "meta.json", "compositions"];
  for (const name of links) {
    const src = join(ROOT, name);
    if (!existsSync(src)) continue;
    const dest = join(dir, name);
    try {
      // Refresh stale symlinks (handles the case where target moved).
      if (existsSync(dest) || lstatSync(dest, { throwIfNoEntry: false } as any)) {
        unlinkSync(dest);
      }
    } catch {}
    const rel = name.includes("/") ? resolve(src) : join("..", "..", name);
    symlinkSync(rel, dest);
  }
  return dir;
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

function mp3FileToDataUri(path: string): string {
  const b64 = readFileSync(path).toString("base64");
  return `data:audio/mp3;base64,${b64}`;
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
          <div class="avatar-label">PRESENTER<br/><span>Yuli · Astria</span></div>
        </div>`;
}

function renderLayout(segment: SegmentYaml, hasAvatar: boolean, audioSrc: string, durationSec: number): string {
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

  if (segment.visual === "presenter-slide" || segment.visual === "avatar-hero") {
    const renderList = (items: string[], starts?: number[]) =>
      items
        .map((b, i) => {
          const t = starts?.[i];
          const attr = typeof t === "number" ? ` data-start="${t.toFixed(2)}"` : "";
          return `<li${attr}>${b}</li>`;
        })
        .join("\n              ");

    const columns = segment.slide?.columns;
    let body: string;
    let totalBullets: number;
    if (columns && columns.length > 0) {
      body =
        `<div class="slide-columns">\n` +
        columns
          .map(
            (col) =>
              `          <div class="slide-column">\n` +
              `            <h2 class="column-heading">${col.heading}</h2>\n` +
              `            <ul class="slide-bullets">\n              ${renderList(col.bullets, col.bullet_starts)}\n            </ul>\n` +
              `          </div>`
          )
          .join("\n") +
        `\n        </div>`;
      totalBullets = columns.reduce((n, c) => n + c.bullets.length, 0);
    } else {
      const bulletList = segment.slide?.bullets ?? [];
      body = `<ul class="slide-bullets" id="slide-bullets">\n              ${renderList(bulletList, segment.slide?.bullet_starts)}\n            </ul>`;
      totalBullets = bulletList.length;
    }

    vars.SLIDE_EYEBROW = segment.slide?.eyebrow ?? "";
    vars.SLIDE_TITLE_HTML = segment.slide?.title_html ?? segment.title;
    vars.SLIDE_BODY_HTML = body;
    // Automatic density: 6+ bullets (total across columns) trigger compact typography.
    vars.SLIDE_FRAME_CLASS = totalBullets >= 6 ? "dense" : "";
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
    // Optional: fade the caption out at a specific time (e.g. when the
    // content on screen has moved past the caption's framing topic).
    vars.CAPTION_HIDE_AT =
      typeof segment.caption?.hide_at === "number"
        ? segment.caption.hide_at.toFixed(2)
        : "";

    // Optional: bullets in the right column (re-uses slide.bullets /
    // slide.bullet_starts schema so authors don't learn a new shape).
    const pipBullets = segment.slide?.bullets ?? [];
    const pipStarts = segment.slide?.bullet_starts;
    if (pipBullets.length) {
      const items = pipBullets
        .map((b, i) => {
          const t = pipStarts?.[i];
          const attr = typeof t === "number" ? ` data-start="${t.toFixed(2)}"` : "";
          return `<li${attr}>${b}</li>`;
        })
        .join("\n          ");
      vars.PIP_BULLETS_HTML = `<ul class="pip-bullets">\n          ${items}\n        </ul>`;
      vars.PIP_VARIANT_CLASS = "with-bullets";
    } else {
      vars.PIP_BULLETS_HTML = "";
      vars.PIP_VARIANT_CLASS = "";
    }
  }

  for (const [k, v] of Object.entries(vars)) {
    html = html.replaceAll(`{{${k}}}`, v);
  }

  const workDir = ensureWorkDir(segment.id);
  writeFileSync(join(workDir, "index.html"), html);
  // Also write to the project-root index.html so single-segment edits can be
  // previewed directly at the repo root. Safe for serial builds; parallel
  // builds use the per-segment work dir for the actual render.
  writeFileSync(join(ROOT, "index.html"), html);
  return workDir;
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
  // Default resolution depends on engine: Pruna only supports 720p/1080p,
  // OmniHuman/InfiniteTalk start at 480p.
  const resolution = segment.avatar?.resolution ?? (engine === "pruna" ? "720p" : "480p");
  const hasReplicate =
    !draftMode &&
    Boolean(process.env.REPLICATE_API_KEY ?? process.env.REPLICATE_API_TOKEN);
  const hasByteplus =
    !draftMode &&
    Boolean(process.env.BYTEPLUS_ACCESS_KEY_ID && process.env.BYTEPLUS_SECRET_ACCESS_KEY);

  // Engines that take the local audio file directly (no WaveSpeed-hosted URL):
  //   - pruna     uploads to Replicate
  //   - byteplus  inlines as base64 in the BytePlus signed call
  // Everything else goes through WaveSpeed and needs a fetchable audio URL
  // (or a base64 data URI built locally).
  const usePruna = engine === "pruna" && hasReplicate && Boolean(imageUrl);
  const useByteplus =
    engine === "omnihuman-1.5-byteplus" && hasByteplus && Boolean(imageUrl);
  const useWaveAvatar =
    !usePruna && !useByteplus && hasWave && Boolean(imageUrl);

  const ttsTier = useGemini ? "gemini" : hasWave ? "inworld" : hasHeygen ? "heygen" : "say";

  const tier = draftMode
    ? "draft"
    : usePruna
    ? `${ttsTier}+pruna`
    : useByteplus
    ? `${ttsTier}+omnihuman-1.5-byteplus`
    : useWaveAvatar
    ? `${ttsTier}+${engine}`
    : useGemini
    ? "gemini"
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

  if (usePruna && imageUrl) {
    // Pruna takes the local audio file directly — no hosted URL required.
    avatarMp4 = await generatePruna(
      segmentId,
      audioMp3,
      imageUrl,
      resolution as "720p" | "1080p"
    );
  } else if (useByteplus && imageUrl) {
    // BytePlus OmniHuman 1.5 — direct call, audio inlined as base64.
    avatarMp4 = await generateOmniHumanByteplus(segmentId, audioMp3, imageUrl);
  } else if (useWaveAvatar && imageUrl) {
    // OmniHuman/InfiniteTalk accept either a URL or a base64 data URI.
    // When TTS gave us a hosted URL (Inworld path) prefer that; otherwise
    // inline the local mp3 so the Gemini-default flow still works.
    const audioInput = audioUrl ?? mp3FileToDataUri(audioMp3);
    if (engine === "infinitetalk") {
      avatarMp4 = await generateInfiniteTalk(
        segmentId,
        audioInput,
        imageUrl,
        resolution as "480p" | "720p"
      );
    } else if (engine === "omnihuman-1.5") {
      avatarMp4 = await generateOmniHuman(segmentId, audioInput, imageUrl, "v1.5");
    } else {
      avatarMp4 = await generateOmniHuman(segmentId, audioInput, imageUrl, "v1");
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
  const workDir = renderLayout(segment, Boolean(avatarMp4), audioSrc, safeDuration);
  if (avatarMp4) anySegmentHasAvatarMp4 = true;
  console.log(`[build] ${segmentId}: visual=${segment.visual} duration=${safeDuration.toFixed(2)}s`);

  // Render this segment's composition from its own work dir so parallel
  // builds don't race on index.html.
  const output = join("out", `${segmentId}.mp4`);
  mkdirSync(join(ROOT, "out"), { recursive: true });
  const workers = process.env.HF_WORKERS ?? (avatarMp4 ? "2" : "4");
  console.log(`[build] ${segmentId}: rendering → ${output} (workers=${workers})`);
  // Pin to 0.4.9 — newer hyperframes (0.4.45+) bumped sharp to 0.34.5, which
  // fails to install on this Mac (sharp falls through to node-gyp build and
  // errors on missing node-addon-api). Bump again once the dep tree settles.
  await runRenderWithEarlyKill([
    "hyperframes@0.4.9", "render",
    workDir,
    "--output", output,
    "--quality", "draft",
    "--workers", workers,
  ]);
  console.log(`[build] ${segmentId}: done → ${join(ROOT, output)}`);
}

async function main() {
  const idx = process.argv.indexOf("--segment");
  const all = process.argv.includes("--all");
  if (idx === -1 && !all) {
    console.error("Usage: tsx pipeline/build.ts --segment <id> | --all [--parallel N]");
    process.exit(1);
  }

  const targets = all ? loadWebinar().segments : [process.argv[idx + 1]];
  const parallelIdx = process.argv.indexOf("--parallel");
  const parallel = parallelIdx !== -1 ? Math.max(1, parseInt(process.argv[parallelIdx + 1] ?? "1", 10)) : 1;

  if (parallel === 1) {
    for (const id of targets) await buildOne(id);
  } else {
    // Simple fixed-width worker pool. Each buildOne renders from its own
    // .work/<id>/ dir so concurrent builds don't race on index.html.
    const queue = [...targets];
    const errors: { id: string; err: unknown }[] = [];
    const runners = Array.from({ length: Math.min(parallel, queue.length) }, async () => {
      while (queue.length) {
        const id = queue.shift()!;
        try {
          await buildOne(id);
        } catch (err) {
          errors.push({ id, err });
        }
      }
    });
    await Promise.all(runners);
    if (errors.length) {
      console.error(`\n${errors.length} segment(s) failed:`);
      for (const { id, err } of errors) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`  ✗ ${id}: ${msg}`);
      }
      process.exit(1);
    }
  }

  console.log(`\n[build] all done → ${targets.length} mp4(s) in out/`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
