/**
 * WaveSpeed InfiniteTalk avatar.
 *
 * Takes an audio URL + image URL → lipsync MP4. Same shape as OmniHuman but
 * supports a `resolution` knob (480p, 720p). Cached by hash(audio+image+res).
 *
 *   tsx pipeline/generate-infinitetalk.ts <segment-id> <audio_url> <image_url> [resolution]
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import "dotenv/config";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const ENDPOINT = "https://api.wavespeed.ai/api/v3/wavespeed-ai/infinitetalk";

function cacheKey(audioUrl: string, imageUrl: string, resolution: string) {
  const h = createHash("sha256");
  h.update(audioUrl);
  h.update("|");
  h.update(imageUrl);
  h.update("|");
  h.update(resolution);
  return h.digest("hex").slice(0, 12);
}

async function submit(audioUrl: string, imageUrl: string, resolution: string): Promise<string> {
  const apiKey = process.env.WAVESPEED_API_KEY;
  if (!apiKey) throw new Error("WAVESPEED_API_KEY not set");
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ audio: audioUrl, image: imageUrl, resolution, seed: -1 }),
  });
  if (!res.ok) throw new Error(`InfiniteTalk submit failed: ${res.status} ${await res.text()}`);
  const json = (await res.json()) as { data: { urls: { get: string } } };
  return json.data.urls.get;
}

async function poll(resultUrl: string, onTick: (s: string) => void): Promise<string> {
  const apiKey = process.env.WAVESPEED_API_KEY!;
  const deadline = Date.now() + 20 * 60 * 1000;  // longer timeout — InfiniteTalk is slower
  while (Date.now() < deadline) {
    const res = await fetch(resultUrl, { headers: { Authorization: `Bearer ${apiKey}` } });
    if (!res.ok) throw new Error(`InfiniteTalk poll failed: ${res.status}`);
    const json = (await res.json()) as {
      data: { status: string; outputs: string[]; error?: string };
    };
    onTick(json.data.status);
    if (json.data.status === "completed" && json.data.outputs[0]) return json.data.outputs[0];
    if (json.data.status === "failed") throw new Error(`InfiniteTalk failed: ${json.data.error}`);
    await new Promise((r) => setTimeout(r, 5000));
  }
  throw new Error("InfiniteTalk poll timeout");
}

async function download(url: string, dest: string) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed: ${res.status}`);
  writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
}

export async function generateInfiniteTalk(
  segmentId: string,
  audioUrl: string,
  imageUrl: string,
  resolution: "480p" | "720p" = "480p"
): Promise<string> {
  const avatarDir = join(ROOT, "assets", "avatars");
  mkdirSync(avatarDir, { recursive: true });
  const key = cacheKey(audioUrl, imageUrl, resolution);
  const cached = join(avatarDir, `${segmentId}.${key}.mp4`);
  const active = join(avatarDir, `${segmentId}.mp4`);

  if (existsSync(cached)) {
    writeFileSync(active, readFileSync(cached));
    console.log(`[infinitetalk] ${segmentId}: cache hit (${key})`);
    return active;
  }

  console.log(`[infinitetalk] ${segmentId}: submitting (resolution=${resolution})`);
  const resultUrl = await submit(audioUrl, imageUrl, resolution);
  const videoUrl = await poll(resultUrl, (s) =>
    process.stdout.write(`\r[infinitetalk] ${segmentId}: ${s}           `)
  );
  process.stdout.write("\n");
  console.log(`[infinitetalk] ${segmentId}: downloading`);
  await download(videoUrl, cached);
  writeFileSync(active, readFileSync(cached));
  console.log(`[infinitetalk] ${segmentId}: cached at ${cached}`);
  return active;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [id, audio, image, resolution = "480p"] = process.argv.slice(2);
  if (!id || !audio || !image) {
    console.error("Usage: tsx pipeline/generate-infinitetalk.ts <segment-id> <audio_url> <image_url> [480p|720p]");
    process.exit(1);
  }
  generateInfiniteTalk(id, audio, image, resolution as "480p" | "720p").catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
