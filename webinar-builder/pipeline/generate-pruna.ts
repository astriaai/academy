/**
 * Pruna AI p-video-avatar lipsync via Replicate.
 *
 * https://replicate.com/prunaai/p-video-avatar
 *
 * Takes a local audio file path + image URL → lipsync MP4. The audio is uploaded
 * to Replicate's files API so this works with any TTS provider (Gemini included),
 * not just ones that produce a hosted URL. Cached by hash(audio bytes + image + res).
 *
 *   tsx pipeline/generate-pruna.ts <segment-id> <audio_path> <image_url> [resolution]
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import "dotenv/config";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const PREDICT_ENDPOINT =
  "https://api.replicate.com/v1/models/prunaai/p-video-avatar/predictions";
const FILES_ENDPOINT = "https://api.replicate.com/v1/files";

export type PrunaResolution = "720p" | "1080p";

function audioCacheKey(audioPath: string, imageUrl: string, resolution: string) {
  const bytes = readFileSync(audioPath);
  const h = createHash("sha256");
  h.update(bytes);
  h.update("|");
  h.update(imageUrl);
  h.update("|");
  h.update(resolution);
  return h.digest("hex").slice(0, 12);
}

async function uploadAudio(audioPath: string, apiKey: string): Promise<string> {
  const buf = readFileSync(audioPath);
  const form = new FormData();
  // Replicate infers the type from the filename extension. Default our TTS
  // outputs to mp3 — pass the basename so the server sees a real extension.
  form.append("content", new Blob([buf]), basename(audioPath));
  const res = await fetch(FILES_ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  if (!res.ok) throw new Error(`Replicate file upload failed: ${res.status} ${await res.text()}`);
  const json = (await res.json()) as { urls: { get: string } };
  return json.urls.get;
}

interface ReplicatePrediction {
  id: string;
  status: "starting" | "processing" | "succeeded" | "failed" | "canceled";
  output?: string | null;
  error?: string | null;
  urls: { get: string; cancel: string };
}

async function submit(
  audioUrl: string,
  imageUrl: string,
  resolution: PrunaResolution,
  apiKey: string
): Promise<ReplicatePrediction> {
  const res = await fetch(PREDICT_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      input: { image: imageUrl, audio: audioUrl, resolution },
    }),
  });
  if (!res.ok) throw new Error(`Pruna submit failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as ReplicatePrediction;
}

async function poll(getUrl: string, onTick: (s: string) => void): Promise<string> {
  const apiKey = (process.env.REPLICATE_API_KEY ?? process.env.REPLICATE_API_TOKEN)!;
  const deadline = Date.now() + 15 * 60 * 1000;
  while (Date.now() < deadline) {
    const res = await fetch(getUrl, { headers: { Authorization: `Bearer ${apiKey}` } });
    if (!res.ok) throw new Error(`Pruna poll failed: ${res.status}`);
    const json = (await res.json()) as ReplicatePrediction;
    onTick(json.status);
    if (json.status === "succeeded" && typeof json.output === "string") return json.output;
    if (json.status === "failed" || json.status === "canceled") {
      throw new Error(`Pruna ${json.status}: ${json.error ?? "unknown error"}`);
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
  throw new Error("Pruna poll timeout");
}

async function download(url: string, dest: string) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed: ${res.status}`);
  writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
}

export async function generatePruna(
  segmentId: string,
  audioPath: string,
  imageUrl: string,
  resolution: PrunaResolution = "720p"
): Promise<string> {
  const apiKey = (process.env.REPLICATE_API_KEY ?? process.env.REPLICATE_API_TOKEN);
  if (!apiKey) throw new Error("REPLICATE_API_KEY (or REPLICATE_API_TOKEN) not set");
  if (!existsSync(audioPath)) throw new Error(`audio file not found: ${audioPath}`);

  const avatarDir = join(ROOT, "assets", "avatars");
  mkdirSync(avatarDir, { recursive: true });
  const key = audioCacheKey(audioPath, imageUrl, resolution);
  const cached = join(avatarDir, `${segmentId}.${key}.mp4`);
  const active = join(avatarDir, `${segmentId}.mp4`);

  if (existsSync(cached)) {
    writeFileSync(active, readFileSync(cached));
    console.log(`[pruna] ${segmentId}: cache hit (${key})`);
    return active;
  }

  const sizeKb = Math.round(statSync(audioPath).size / 1024);
  console.log(`[pruna] ${segmentId}: uploading audio (${sizeKb} KB) to Replicate`);
  const audioUrl = await uploadAudio(audioPath, apiKey);
  console.log(`[pruna] ${segmentId}: submitting (resolution=${resolution})`);
  const submitted = await submit(audioUrl, imageUrl, resolution, apiKey);
  const videoUrl = await poll(submitted.urls.get, (s) =>
    process.stdout.write(`\r[pruna] ${segmentId}: ${s}           `)
  );
  process.stdout.write("\n");
  console.log(`[pruna] ${segmentId}: downloading`);
  await download(videoUrl, cached);
  writeFileSync(active, readFileSync(cached));
  console.log(`[pruna] ${segmentId}: cached at ${cached}`);
  return active;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [id, audio, image, resolution = "720p"] = process.argv.slice(2);
  if (!id || !audio || !image) {
    console.error("Usage: tsx pipeline/generate-pruna.ts <segment-id> <audio_path> <image_url> [720p|1080p]");
    process.exit(1);
  }
  generatePruna(id, audio, image, resolution as PrunaResolution).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
