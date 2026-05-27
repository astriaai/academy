/**
 * WaveSpeed LongCat Avatar 1.5.
 *
 * Takes an audio URL/data URI + image URL/data URI and returns a talking-avatar
 * MP4. LongCat is capped by the provider at 30 seconds per clip.
 *
 *   tsx pipeline/generate-longcat.ts [--project <name>] [--prompt <text>] <segment-id> <audio_url> <image_url> [480p|720p]
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import "dotenv/config";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const ENDPOINT = "https://api.wavespeed.ai/api/v3/wavespeed-ai/longcat-avatar-1.5";

function resolveMediaInput(ref: string, kind: "audio" | "image"): string {
  if (/^(https?:|data:)/.test(ref)) return ref;
  const abs = resolve(ROOT, ref);
  if (!existsSync(abs)) throw new Error(`${kind} input not found: ${ref}`);
  if (kind === "audio") {
    const mime = abs.toLowerCase().endsWith(".wav") ? "audio/wav" : "audio/mp3";
    return `data:${mime};base64,${readFileSync(abs).toString("base64")}`;
  }
  const mime = abs.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg";
  return `data:${mime};base64,${readFileSync(abs).toString("base64")}`;
}

function cacheKey(audioUrl: string, imageUrl: string, resolution: string, prompt: string) {
  const h = createHash("sha256");
  h.update(audioUrl);
  h.update("|");
  h.update(imageUrl);
  h.update("|");
  h.update(resolution);
  h.update("|");
  h.update(prompt);
  return h.digest("hex").slice(0, 12);
}

async function submit(
  audioUrl: string,
  imageUrl: string,
  resolution: "480p" | "720p",
  prompt: string,
): Promise<string> {
  const apiKey = process.env.WAVESPEED_API_KEY;
  if (!apiKey) throw new Error("WAVESPEED_API_KEY not set");

  const body: Record<string, unknown> = {
    audio: audioUrl,
    image: imageUrl,
    resolution,
    seed: -1,
  };
  if (prompt) body.prompt = prompt;

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`LongCat submit failed: ${res.status} ${await res.text()}`);
  const json = (await res.json()) as { data: { urls?: { get?: string }; id?: string } };
  if (json.data.urls?.get) return json.data.urls.get;
  if (json.data.id) return `https://api.wavespeed.ai/api/v3/predictions/${json.data.id}/result`;
  throw new Error(`LongCat submit returned no poll URL: ${JSON.stringify(json)}`);
}

async function poll(resultUrl: string, onTick: (s: string) => void): Promise<string> {
  const apiKey = process.env.WAVESPEED_API_KEY!;
  const deadline = Date.now() + 20 * 60 * 1000;
  while (Date.now() < deadline) {
    const res = await fetch(resultUrl, { headers: { Authorization: `Bearer ${apiKey}` } });
    if (!res.ok) throw new Error(`LongCat poll failed: ${res.status} ${await res.text()}`);
    const json = (await res.json()) as {
      data: { status: string; outputs?: string[]; error?: string };
    };
    onTick(json.data.status);
    if (json.data.status === "completed" && json.data.outputs?.[0]) return json.data.outputs[0];
    if (json.data.status === "failed") throw new Error(`LongCat failed: ${json.data.error}`);
    await new Promise((r) => setTimeout(r, 5000));
  }
  throw new Error("LongCat poll timeout");
}

async function download(url: string, dest: string) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed: ${res.status}`);
  writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
}

export async function generateLongCat(
  project: string,
  segmentId: string,
  audioUrl: string,
  imageUrl: string,
  resolution: "480p" | "720p" = "480p",
  prompt: string = "",
): Promise<string> {
  const avatarDir = join(ROOT, "assets", "avatars", project);
  mkdirSync(avatarDir, { recursive: true });
  const key = cacheKey(audioUrl, imageUrl, resolution, prompt);
  const cached = join(avatarDir, `${segmentId}.longcat-${key}.mp4`);
  const active = join(avatarDir, `${segmentId}.mp4`);

  if (existsSync(cached)) {
    writeFileSync(active, readFileSync(cached));
    console.log(`[longcat] ${segmentId}: cache hit (${key})`);
    return active;
  }

  const promptSummary = prompt
    ? ` prompt="${prompt.slice(0, 60)}${prompt.length > 60 ? "..." : ""}"`
    : "";
  console.log(`[longcat] ${segmentId}: submitting (resolution=${resolution})${promptSummary}`);
  const resultUrl = await submit(audioUrl, imageUrl, resolution, prompt);
  const videoUrl = await poll(resultUrl, (s) =>
    process.stdout.write(`\r[longcat] ${segmentId}: ${s}           `),
  );
  process.stdout.write("\n");
  console.log(`[longcat] ${segmentId}: downloading`);
  await download(videoUrl, cached);
  writeFileSync(active, readFileSync(cached));
  console.log(`[longcat] ${segmentId}: cached at ${cached}`);
  return active;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const projectIdx = process.argv.indexOf("--project");
  const project = projectIdx !== -1 ? process.argv[projectIdx + 1] : "webinar";
  const promptIdx = process.argv.indexOf("--prompt");
  const prompt = promptIdx !== -1 ? process.argv[promptIdx + 1] : "";
  const positional = process.argv.slice(2).filter((a, i, arr) => {
    if (a === "--project" || a === "--prompt") return false;
    if (i > 0 && (arr[i - 1] === "--project" || arr[i - 1] === "--prompt")) return false;
    return true;
  });
  const [id, audio, image, resolution = "480p"] = positional;
  if (!id || !audio || !image) {
    console.error(
      "Usage: tsx pipeline/generate-longcat.ts [--project <name>] [--prompt <text>] <segment-id> <audio_url> <image_url> [480p|720p]",
    );
    process.exit(1);
  }
  try {
    const audioInput = resolveMediaInput(audio, "audio");
    const imageInput = resolveMediaInput(image, "image");
    generateLongCat(project, id, audioInput, imageInput, resolution as "480p" | "720p", prompt).catch((e) => {
      console.error(e);
      process.exit(1);
    });
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
}
