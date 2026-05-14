/**
 * Astria Seedance v1.5 video generator with first-frame + last-frame
 * support. Wraps POST /tunes/:tune_id/prompts on api.astria.ai, polls until
 * the prompt yields a video/mp4 attachment, downloads it locally.
 *
 *   tsx pipeline/generate-seedance-astria.ts \
 *     --output assets/avatars/video-style-transfer/00-intro-seedance.mp4 \
 *     --first  assets/avatars/video-style-transfer/intro-fullbody.jpg \
 *     --last   assets/avatars/video-style-transfer/intro-face-mic.jpg \
 *     --prompt "She walks toward camera, beckons with her finger…" \
 *     [--model seedance_v15_720p] \
 *     [--duration 6] \
 *     [--aspect 16:9]
 *
 * Env (from .env via dotenv): ASTRIA_AUTH_TOKEN, ASTRIA_BASE_URL,
 *                              GEMINI_TUNE_ID, WORKSPACE_ID.
 *
 * Only seedance_v15_* (and a handful of others) support video_last_frame.
 * seedance2_* does NOT — verified against sdbooth's
 * SeedanceVideoPrompt::VIDEO_MODELS_WITH_LAST_FRAME (lines 310-331).
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import "dotenv/config";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

interface SubmitArgs {
  output: string;
  firstFrame: string;
  lastFrame?: string;
  prompt: string;
  videoModel?: string;        // default "seedance_v15_720p"
  duration?: number;          // default 5
  aspectRatio?: string;       // default "16:9"
  text?: string;              // optional natural-language prefix
  tuneId?: string;            // default $GEMINI_TUNE_ID
}

function sha1(...inputs: Array<string | Buffer>) {
  const h = createHash("sha1");
  for (const i of inputs) h.update(i);
  return h.digest("hex").slice(0, 16);
}

function attachFile(form: FormData, name: string, path: string) {
  const abs = resolve(path);
  if (!existsSync(abs)) throw new Error(`file not found: ${abs}`);
  const buf = readFileSync(abs);
  const mime = abs.endsWith(".png") ? "image/png" : "image/jpeg";
  form.append(name, new Blob([buf], { type: mime }), basename(abs));
}

interface PromptResponse {
  id: number;
  text?: string;
  video_model?: string;
  video_prompt?: string;
  video_duration?: number;
  trained_at?: string | null;
  user_error?: string | null;
  /**
   * Astria returns three parallel arrays for the rendered attachments.
   * Pair `images[i]` with `content_types[i]` to find the video/mp4 URL.
   */
  images?: string[];
  content_types?: string[];
  filenames?: string[];
}

async function submit(args: SubmitArgs): Promise<PromptResponse> {
  const token = process.env.ASTRIA_AUTH_TOKEN;
  const base = process.env.ASTRIA_BASE_URL;
  const workspaceId = process.env.WORKSPACE_ID;
  const tuneId = args.tuneId ?? process.env.GEMINI_TUNE_ID;
  if (!token || !base || !tuneId) {
    throw new Error("ASTRIA_AUTH_TOKEN / ASTRIA_BASE_URL / GEMINI_TUNE_ID must be set in .env");
  }
  const baseUrl = base.startsWith("http") ? base : `https://${base}`;

  const form = new FormData();
  if (args.text) form.append("prompt[text]", args.text);
  form.append("prompt[video_model]", args.videoModel ?? "seedance_v15_720p");
  form.append("prompt[video_prompt]", args.prompt);
  form.append("prompt[video_duration]", String(args.duration ?? 5));
  form.append("prompt[aspect_ratio]", args.aspectRatio ?? "16:9");
  attachFile(form, "prompt[video_first_frame]", args.firstFrame);
  if (args.lastFrame) attachFile(form, "prompt[video_last_frame]", args.lastFrame);

  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (workspaceId) headers["X-Workspace-Id"] = workspaceId;

  const url = `${baseUrl}/tunes/${tuneId}/prompts`;
  console.log(`[seedance-astria] POST ${url} model=${args.videoModel ?? "seedance_v15_720p"} duration=${args.duration ?? 5}s aspect=${args.aspectRatio ?? "16:9"}`);
  const res = await fetch(url, { method: "POST", headers, body: form });
  if (!res.ok) {
    throw new Error(`Astria submit HTTP ${res.status}: ${await res.text()}`);
  }
  const json = (await res.json()) as PromptResponse;
  console.log(`[seedance-astria] prompt id=${json.id} created`);
  return json;
}

async function pollUntilReady(promptId: number, tuneId: string): Promise<string> {
  const token = process.env.ASTRIA_AUTH_TOKEN!;
  const base = (process.env.ASTRIA_BASE_URL ?? "").startsWith("http")
    ? process.env.ASTRIA_BASE_URL!
    : `https://${process.env.ASTRIA_BASE_URL}`;
  const workspaceId = process.env.WORKSPACE_ID;
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (workspaceId) headers["X-Workspace-Id"] = workspaceId;

  const url = `${base}/tunes/${tuneId}/prompts/${promptId}`;
  const deadline = Date.now() + 20 * 60 * 1000;
  let tick = 0;
  while (Date.now() < deadline) {
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`Astria poll HTTP ${res.status}: ${await res.text()}`);
    const body = (await res.json()) as PromptResponse;
    if (body.user_error) {
      throw new Error(`Astria prompt ${promptId} errored: ${body.user_error}`);
    }
    // Parallel arrays: images[i] is the URL, content_types[i] tells us mime.
    const urls = body.images ?? [];
    const types = body.content_types ?? [];
    const videoIdx = types.findIndex((t) => t?.startsWith("video/"));
    if (videoIdx !== -1 && urls[videoIdx] && body.trained_at) {
      process.stdout.write("\n");
      console.log(`[seedance-astria] prompt ${promptId}: ready → ${urls[videoIdx]}`);
      return urls[videoIdx]!;
    }
    process.stdout.write(`\r[seedance-astria] prompt ${promptId}: polling (tick ${tick++})           `);
    await new Promise((r) => setTimeout(r, 6000));
  }
  throw new Error(`Astria poll timeout for prompt ${promptId}`);
}

async function download(url: string, dest: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, buf);
  console.log(`[seedance-astria] saved ${dest} (${buf.length} bytes)`);
}

function cachePath(args: SubmitArgs): string {
  const firstBytes = readFileSync(resolve(args.firstFrame));
  const lastBytes = args.lastFrame ? readFileSync(resolve(args.lastFrame)) : Buffer.alloc(0);
  const key = sha1(
    firstBytes,
    lastBytes,
    args.prompt,
    args.videoModel ?? "seedance_v15_720p",
    String(args.duration ?? 5),
    args.aspectRatio ?? "16:9",
  );
  return join(ROOT, ".cache", "seedance-astria", `${key}.mp4`);
}

export async function generateSeedanceAstria(args: SubmitArgs): Promise<string> {
  const cached = cachePath(args);
  mkdirSync(dirname(cached), { recursive: true });
  const out = resolve(args.output);
  mkdirSync(dirname(out), { recursive: true });

  if (existsSync(cached)) {
    writeFileSync(out, readFileSync(cached));
    console.log(`[seedance-astria] cache hit → ${out}`);
    return out;
  }

  const tuneId = args.tuneId ?? process.env.GEMINI_TUNE_ID!;
  const created = await submit(args);
  const videoUrl = await pollUntilReady(created.id, tuneId);
  await download(videoUrl, cached);
  writeFileSync(out, readFileSync(cached));
  console.log(`[seedance-astria] done → ${out}`);
  return out;
}

// CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  const arg = (name: string) => {
    const i = argv.indexOf(name);
    return i !== -1 ? argv[i + 1] : undefined;
  };

  const output = arg("--output");
  const firstFrame = arg("--first");
  const lastFrame = arg("--last");
  const prompt = arg("--prompt");
  const videoModel = arg("--model");
  const duration = arg("--duration") ? Number(arg("--duration")) : undefined;
  const aspectRatio = arg("--aspect");
  const text = arg("--text");

  if (!output || !firstFrame || !prompt) {
    console.error(
      "Usage: tsx pipeline/generate-seedance-astria.ts --output <path.mp4> --first <path.jpg> --prompt <text> [--last <path.jpg>] [--model seedance_v15_720p] [--duration 5] [--aspect 16:9] [--text <prefix>]",
    );
    process.exit(1);
  }

  generateSeedanceAstria({ output, firstFrame, lastFrame, prompt, videoModel, duration, aspectRatio, text })
    .then((p) => console.log(`[seedance-astria] saved: ${p}`))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
