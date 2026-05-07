/**
 * BytePlus OmniHuman 1.5 — direct call (not via WaveSpeed).
 *
 * Uses the V4-signed cv.byteplusapi.com endpoint with req_key
 * `realman_avatar_picture_omni15_cv`. Audio is sent inline as base64 so the
 * pipeline works with any TTS provider (Gemini-default included). Image is
 * passed by URL — BytePlus fetches it server-side.
 *
 * Cached by hash(audio bytes + image url) so re-runs are free.
 *
 *   tsx pipeline/generate-omnihuman-byteplus.ts <segment-id> <audio_path> <image_url>
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import "dotenv/config";

import { byteplusVisualCall } from "./byteplus-signer.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const REQ_KEY = "realman_avatar_picture_omni15_cv";

function cacheKey(audioPath: string, imageUrl: string) {
  const audioHash = createHash("sha256").update(readFileSync(audioPath)).digest("hex");
  const h = createHash("sha256");
  h.update(audioHash);
  h.update("|");
  h.update(imageUrl);
  h.update("|");
  h.update(REQ_KEY);
  return h.digest("hex").slice(0, 12);
}

interface SubmitResp {
  task_id: string;
}

interface PollResp {
  status: string;        // "in_queue" | "generating" | "done" | "failed" | …
  resp_data?: string;    // JSON-string when status === "done"
  err_msg?: string;
}

interface OutputData {
  // BytePlus serialises the actual output as a JSON string under resp_data.
  // The video field name has been observed as either video_url or simply a
  // urls array — try both rather than relying on a single shape.
  video_url?: string;
  urls?: string[];
}

async function download(url: string, dest: string) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed: ${res.status}`);
  writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
}

export async function generateOmniHumanByteplus(
  segmentId: string,
  audioPath: string,
  imageUrl: string
): Promise<string> {
  if (!existsSync(audioPath)) throw new Error(`audio file not found: ${audioPath}`);

  const avatarDir = join(ROOT, "assets", "avatars");
  mkdirSync(avatarDir, { recursive: true });
  const key = cacheKey(audioPath, imageUrl);
  const cached = join(avatarDir, `${segmentId}.${key}.mp4`);
  const active = join(avatarDir, `${segmentId}.mp4`);

  if (existsSync(cached)) {
    writeFileSync(active, readFileSync(cached));
    console.log(`[omnihuman-byteplus] ${segmentId}: cache hit (${key})`);
    return active;
  }

  const audioB64 = readFileSync(audioPath).toString("base64");
  const sizeKb = Math.round(statSync(audioPath).size / 1024);
  console.log(
    `[omnihuman-byteplus] ${segmentId}: submitting (audio=${sizeKb} KB base64, image=${imageUrl})`
  );

  const submit = await byteplusVisualCall<SubmitResp>({
    action: "CVSubmitTask",
    body: {
      req_key: REQ_KEY,
      image_url: imageUrl,
      audio_base64: audioB64,
    },
  });
  if (submit.code !== 10000 || !submit.data?.task_id) {
    throw new Error(`BytePlus OmniHuman submit failed: ${JSON.stringify(submit)}`);
  }
  const taskId = submit.data.task_id;
  console.log(`[omnihuman-byteplus] ${segmentId}: task_id=${taskId}`);

  const deadline = Date.now() + 15 * 60 * 1000;
  let videoUrl: string | undefined;
  while (Date.now() < deadline) {
    const poll = await byteplusVisualCall<PollResp>({
      action: "CVGetResult",
      body: { req_key: REQ_KEY, task_id: taskId },
    });
    if (poll.code !== 10000) {
      throw new Error(`BytePlus OmniHuman poll failed: ${JSON.stringify(poll)}`);
    }
    const status = poll.data!.status;
    process.stdout.write(`\r[omnihuman-byteplus] ${segmentId}: ${status}           `);
    if (status === "done") {
      const parsed = JSON.parse(poll.data!.resp_data ?? "{}") as OutputData;
      videoUrl = parsed.video_url ?? parsed.urls?.[0];
      if (!videoUrl) {
        throw new Error(
          `BytePlus OmniHuman returned no video URL: ${poll.data!.resp_data}`
        );
      }
      break;
    }
    if (status !== "in_queue" && status !== "generating") {
      throw new Error(
        `BytePlus OmniHuman terminal status: ${status} ${poll.data!.err_msg ?? ""}`
      );
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
  process.stdout.write("\n");
  if (!videoUrl) throw new Error("BytePlus OmniHuman poll timeout");

  console.log(`[omnihuman-byteplus] ${segmentId}: downloading`);
  await download(videoUrl, cached);
  writeFileSync(active, readFileSync(cached));
  console.log(`[omnihuman-byteplus] ${segmentId}: cached at ${cached}`);
  return active;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [id, audio, image] = process.argv.slice(2);
  if (!id || !audio || !image) {
    console.error(
      "Usage: tsx pipeline/generate-omnihuman-byteplus.ts <segment-id> <audio_path> <image_url>"
    );
    process.exit(1);
  }
  generateOmniHumanByteplus(id, audio, image).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
