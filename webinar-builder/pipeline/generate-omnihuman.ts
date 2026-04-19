/**
 * ByteDance OmniHuman avatar via WaveSpeed.
 *
 * Takes an audio URL + image URL → lipsync MP4 where the person in the image
 * appears to speak the audio. Output saved to assets/avatars/<segment-id>.mp4,
 * cached by hash(audio_url + image_url).
 *
 *   tsx pipeline/generate-omnihuman.ts <segment-id> <audio_url> <image_url>
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import "dotenv/config";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const OMNI_ENDPOINT =
  "https://api.wavespeed.ai/api/v3/bytedance/avatar-omni-human";

function cacheKey(audioUrl: string, imageUrl: string) {
  const h = createHash("sha256");
  h.update(audioUrl);
  h.update("|");
  h.update(imageUrl);
  return h.digest("hex").slice(0, 12);
}

async function submit(audioUrl: string, imageUrl: string): Promise<string> {
  const apiKey = process.env.WAVESPEED_API_KEY;
  if (!apiKey) throw new Error("WAVESPEED_API_KEY not set");

  const res = await fetch(OMNI_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      audio: audioUrl,
      image: imageUrl,
      enable_base64_output: false,
    }),
  });
  if (!res.ok) throw new Error(`OmniHuman submit failed: ${res.status} ${await res.text()}`);
  const json = (await res.json()) as { data: { urls: { get: string } } };
  return json.data.urls.get;
}

async function poll(resultUrl: string, onTick: (s: string) => void): Promise<string> {
  const apiKey = process.env.WAVESPEED_API_KEY!;
  const deadline = Date.now() + 15 * 60 * 1000;
  while (Date.now() < deadline) {
    const res = await fetch(resultUrl, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) throw new Error(`OmniHuman poll failed: ${res.status}`);
    const json = (await res.json()) as {
      data: { status: string; outputs: string[]; error?: string; timings?: { inference?: number } };
    };
    onTick(json.data.status);
    if (json.data.status === "completed" && json.data.outputs[0]) return json.data.outputs[0];
    if (json.data.status === "failed") throw new Error(`OmniHuman failed: ${json.data.error}`);
    await new Promise((r) => setTimeout(r, 5000));
  }
  throw new Error("OmniHuman poll timeout");
}

async function download(url: string, dest: string) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed: ${res.status}`);
  writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
}

export async function generateOmniHuman(
  segmentId: string,
  audioUrl: string,
  imageUrl: string
): Promise<string> {
  const avatarDir = join(ROOT, "assets", "avatars");
  mkdirSync(avatarDir, { recursive: true });
  const key = cacheKey(audioUrl, imageUrl);
  const cached = join(avatarDir, `${segmentId}.${key}.mp4`);
  const active = join(avatarDir, `${segmentId}.mp4`);

  if (existsSync(cached)) {
    writeFileSync(active, readFileSync(cached));
    console.log(`[omnihuman] ${segmentId}: cache hit (${key})`);
    return active;
  }

  console.log(`[omnihuman] ${segmentId}: submitting (audio=${audioUrl.slice(0, 60)}… image=${imageUrl})`);
  const resultUrl = await submit(audioUrl, imageUrl);
  const videoUrl = await poll(resultUrl, (s) =>
    process.stdout.write(`\r[omnihuman] ${segmentId}: ${s}           `)
  );
  process.stdout.write("\n");
  console.log(`[omnihuman] ${segmentId}: downloading`);
  await download(videoUrl, cached);
  writeFileSync(active, readFileSync(cached));
  console.log(`[omnihuman] ${segmentId}: cached at ${cached}`);
  return active;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [id, audio, image] = process.argv.slice(2);
  if (!id || !audio || !image) {
    console.error("Usage: tsx pipeline/generate-omnihuman.ts <segment-id> <audio_url> <image_url>");
    process.exit(1);
  }
  generateOmniHuman(id, audio, image).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
