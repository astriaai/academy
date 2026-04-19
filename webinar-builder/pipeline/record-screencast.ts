/**
 * Playwright-driven screencast recorder.
 *
 * Runs a per-segment recording script (scripts/record/<id>.ts) inside a
 * headed-size Chromium, records the browser viewport to webm, and transcodes
 * to mp4. Re-running the same script with the same inputs produces a fresh
 * capture — the idea is that when Astria's UI changes you just re-run.
 *
 *   tsx pipeline/record-screencast.ts <segment-id>
 *
 * Looks up the segment's recording script from:
 *   scripts/record/<segment-id>.ts
 *
 * Outputs:
 *   assets/captures/<segment-id>.mp4
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { chromium, type BrowserContext, type Page } from "playwright";
import "dotenv/config";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const VIEWPORT = { width: 1600, height: 900 };

export interface RecordApi {
  page: Page;
  /** `sleep(1000)` — insert pauses for narration beats. */
  sleep: (ms: number) => Promise<void>;
  /** Move a synthetic cursor + click, with a short settle pause afterwards. */
  clickWithPause: (selector: string, afterMs?: number) => Promise<void>;
}

export type RecordScript = (api: RecordApi) => Promise<void>;

function run(cmd: string, args: string[]) {
  const r = spawnSync(cmd, args, { stdio: "inherit" });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} exited with ${r.status}`);
}

async function runRecording(segmentId: string, script: RecordScript) {
  const capturesDir = join(ROOT, "assets", "captures");
  mkdirSync(capturesDir, { recursive: true });
  const workDir = join(capturesDir, `${segmentId}.work`);
  if (existsSync(workDir)) rmSync(workDir, { recursive: true, force: true });
  mkdirSync(workDir, { recursive: true });

  // HEADED=1 → visible browser (watch the interaction in real time).
  // SLOWMO=<ms> → slow each Playwright action by N ms. Default 0 because
  // slowMo gets multiplied across each mouse step and blows up the recording
  // duration (e.g. 120 × 30 steps × 9 cubes ≈ 30 seconds just for one tour).
  // Set SLOWMO=200 explicitly if you want a slow-motion live watch.
  const headed = process.env.HEADED === "1" || process.argv.includes("--headed");
  const slowMo = Number(process.env.SLOWMO ?? 0);
  if (headed) {
    console.log(`[record] ${segmentId}: HEADED mode (slowMo=${slowMo}ms) — Chromium window will open`);
  }

  const browser = await chromium.launch({ headless: !headed, slowMo });
  const storageStatePath = join(ROOT, "storageState.json");
  const useStorageState = existsSync(storageStatePath);
  if (useStorageState) {
    console.log(`[record] ${segmentId}: using saved Astria session (storageState.json)`);
  }
  const context: BrowserContext = await browser.newContext({
    viewport: VIEWPORT,
    recordVideo: { dir: workDir, size: VIEWPORT },
    deviceScaleFactor: 2,                     // retina-sharp text
    colorScheme: "dark",
    ...(useStorageState ? { storageState: storageStatePath } : {}),
  });
  const page = await context.newPage();

  const api: RecordApi = {
    page,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    async clickWithPause(selector, afterMs = 1200) {
      const handle = await page.waitForSelector(selector, { state: "visible" });
      const box = await handle.boundingBox();
      if (box) {
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 20 });
      }
      await handle.click();
      await new Promise((r) => setTimeout(r, afterMs));
    },
  };

  try {
    console.log(`[record] ${segmentId}: running recording script…`);
    await script(api);
  } finally {
    await context.close();         // flushes video to disk
    await browser.close();
  }

  // The webm lives in workDir under a generated name — grab the newest one.
  const webms = readdirSync(workDir)
    .filter((f) => f.endsWith(".webm"))
    .map((f) => ({ f, mtime: statSync(join(workDir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  if (webms.length === 0) throw new Error("Playwright produced no webm");
  const webmPath = join(workDir, webms[0].f);

  // Transcode to mp4 with dense keyframes (fixes HyperFrames' sparse-keyframe warning)
  const mp4Path = join(capturesDir, `${segmentId}.mp4`);
  console.log(`[record] ${segmentId}: transcoding webm → mp4 with GOP=30`);
  run("ffmpeg", [
    "-y",
    "-i", webmPath,
    "-c:v", "libx264",
    "-r", "30",
    "-g", "30",
    "-keyint_min", "30",
    "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",
    "-an",                          // strip audio — narration comes from <audio> track
    mp4Path,
  ]);

  rmSync(workDir, { recursive: true, force: true });
  console.log(`[record] ${segmentId}: wrote ${mp4Path}`);
  return mp4Path;
}

export async function recordScreencast(segmentId: string): Promise<string> {
  const scriptPath = join(ROOT, "scripts", "record", `${segmentId}.ts`);
  if (!existsSync(scriptPath)) throw new Error(`Recording script not found: ${scriptPath}`);

  // Dynamic import — tsx resolves the TS module
  const mod = await import(scriptPath);
  const script: RecordScript = mod.default ?? mod.script;
  if (typeof script !== "function") {
    throw new Error(`${scriptPath} must export a default async function (api) => ...`);
  }
  return runRecording(segmentId, script);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const id = process.argv[2];
  if (!id) {
    console.error("Usage: tsx pipeline/record-screencast.ts <segment-id>");
    process.exit(1);
  }
  recordScreencast(id).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
