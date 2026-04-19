/**
 * BytePlus OmniHuman subject preflight — two calls:
 *
 *   1. Subject Recognition (async, req_key=realman_avatar_picture_create_role_omni_cv)
 *      → "does this image contain a human/anthropomorphic subject?" (0 or 1)
 *
 *   2. Subject Detection (sync, req_key=realman_avatar_object_detection_cv)
 *      → returns a list of mask image URLs (largest-to-smallest area)
 *
 * Both are cached by image URL so repeated runs are free.
 *
 *   tsx pipeline/byteplus-subject.ts <image_url>
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { byteplusVisualCall } from "./byteplus-signer.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const REQ_KEY_RECOGNITION = "realman_avatar_picture_create_role_omni_cv";
const REQ_KEY_DETECTION = "realman_avatar_object_detection_cv";

function cacheFile(kind: string, imageUrl: string) {
  const hash = createHash("sha256").update(imageUrl).digest("hex").slice(0, 12);
  const dir = join(ROOT, ".cache", "byteplus");
  mkdirSync(dir, { recursive: true });
  return join(dir, `${kind}-${hash}.json`);
}

export interface RecognitionResult {
  /** 1 if image contains a human/human-like subject, 0 otherwise */
  status: number;
}

export interface DetectionResult {
  /** Mask image URLs ordered largest → smallest area */
  maskUrls: string[];
}

export async function recognizeSubject(imageUrl: string): Promise<RecognitionResult> {
  const cache = cacheFile("recognition", imageUrl);
  if (existsSync(cache)) {
    return JSON.parse(readFileSync(cache, "utf-8"));
  }

  const submit = await byteplusVisualCall<{ task_id: string }>({
    action: "CVSubmitTask",
    body: { req_key: REQ_KEY_RECOGNITION, image_url: imageUrl },
  });
  if (submit.code !== 10000 || !submit.data?.task_id) {
    throw new Error(`recognition submit failed: ${JSON.stringify(submit)}`);
  }
  const taskId = submit.data.task_id;

  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const poll = await byteplusVisualCall<{ status: string; resp_data: string }>({
      action: "CVGetResult",
      body: { req_key: REQ_KEY_RECOGNITION, task_id: taskId },
    });
    if (poll.code !== 10000) throw new Error(`recognition poll failed: ${JSON.stringify(poll)}`);
    const status = poll.data!.status;
    if (status === "done") {
      const parsed = JSON.parse(poll.data!.resp_data) as { status: number };
      const result = { status: parsed.status };
      writeFileSync(cache, JSON.stringify(result));
      return result;
    }
    if (status !== "in_queue" && status !== "generating") {
      throw new Error(`recognition terminal status: ${status}`);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("recognition poll timeout");
}

export async function detectSubjectMasks(imageUrl: string): Promise<DetectionResult> {
  const cache = cacheFile("detection", imageUrl);
  if (existsSync(cache)) {
    return JSON.parse(readFileSync(cache, "utf-8"));
  }

  const resp = await byteplusVisualCall<{ resp_data: string }>({
    action: "CVProcess",
    body: { req_key: REQ_KEY_DETECTION, image_url: imageUrl },
  });
  if (resp.code !== 10000 || !resp.data?.resp_data) {
    throw new Error(`detection failed: ${JSON.stringify(resp)}`);
  }
  const parsed = JSON.parse(resp.data.resp_data) as {
    object_detection_result: { mask: { url: string[] } };
  };
  const result = { maskUrls: parsed.object_detection_result.mask.url };
  writeFileSync(cache, JSON.stringify(result));
  return result;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const imageUrl = process.argv[2];
  if (!imageUrl) {
    console.error("Usage: tsx pipeline/byteplus-subject.ts <image_url>");
    process.exit(1);
  }
  (async () => {
    console.log(`[byteplus] recognizing subject in: ${imageUrl}`);
    const recog = await recognizeSubject(imageUrl);
    console.log(`  status=${recog.status} (${recog.status === 1 ? "human/anthropomorphic detected" : "no human detected"})`);
    if (recog.status !== 1) {
      console.warn("  ⚠ image does not contain a recognised subject — OmniHuman may reject it");
    }
    console.log(`[byteplus] detecting subject masks…`);
    const det = await detectSubjectMasks(imageUrl);
    console.log(`  ${det.maskUrls.length} mask(s):`);
    det.maskUrls.forEach((u, i) => console.log(`    [${i}] ${u}`));
  })().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
