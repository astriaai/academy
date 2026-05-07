/**
 * Analyze a segment of astria-webinar.mp4 with Gemini (via Vertex AI API-key mode).
 *
 *   tsx pipeline/gemini-inspect.ts <start hh:mm:ss> <end hh:mm:ss> [segment-id]
 *
 * What it does:
 *   1. Chops the segment out of ../astria-webinar.mp4 with ffmpeg,
 *      downscaling + recompressing so the result fits in the 20 MB inline limit.
 *   2. POSTs the clip as inlineData to Gemini 2.5 Flash (fast, video-capable).
 *   3. Asks a structured prompt: visible URLs, on-screen UI state, ordered list
 *      of user interactions (hover / click / right-click / type / scroll).
 *   4. Prints the JSON report and (if a segment-id is given) writes it to
 *      `.cache/gemini/<segment-id>.json` for downstream tools.
 *
 * The JSON shape is designed to drop straight into a `scripts/intent/<id>.yaml`
 * with minimal editing.
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, statSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import "dotenv/config";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const WEBINAR = resolve(ROOT, "..", "astria-webinar.mp4");

const MODEL = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

// 20 MB hard ceiling on inline request bodies. We leave margin for JSON wrapping.
const MAX_INLINE_BYTES = 18 * 1024 * 1024;

function tsToSec(ts: string): number {
  const [h, m, s] = ts.split(":").map(Number);
  return h * 3600 + m * 60 + s;
}
function run(cmd: string, args: string[]) {
  const r = spawnSync(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
  if (r.status !== 0) {
    throw new Error(`${cmd} failed: ${r.stderr.toString().slice(0, 400)}`);
  }
  return r;
}

function chopSegment(startSec: number, durationSec: number): string {
  mkdirSync(join(ROOT, ".cache", "gemini"), { recursive: true });
  const outPath = join(
    ROOT,
    ".cache",
    "gemini",
    `clip-${Math.round(startSec)}-${Math.round(durationSec)}.mp4`
  );
  if (existsSync(outPath) && statSync(outPath).size <= MAX_INLINE_BYTES) return outPath;

  // Tiers, progressively smaller. Text-heavy UI reads fine at 10-15 fps.
  const encode = (width: number, fps: number, crf: number) => {
    run("ffmpeg", [
      "-y",
      "-ss", String(startSec),
      "-i", WEBINAR,
      "-t", String(durationSec),
      "-r", String(fps),
      "-vf", `scale=${width}:-2`,
      "-c:v", "libx264",
      "-crf", String(crf),
      "-preset", "veryfast",
      "-g", String(fps * 2),
      "-an",
      "-movflags", "+faststart",
      outPath,
    ]);
  };

  encode(960, 15, 30);
  if (statSync(outPath).size > MAX_INLINE_BYTES) encode(720, 12, 32);
  if (statSync(outPath).size > MAX_INLINE_BYTES) encode(480, 10, 34);
  if (statSync(outPath).size > MAX_INLINE_BYTES) encode(360, 8, 36);
  const finalSize = statSync(outPath).size;
  if (finalSize > MAX_INLINE_BYTES) {
    throw new Error(
      `clip too large after aggressive compression (${(finalSize / 1024 / 1024).toFixed(1)} MB). ` +
      `Pick a shorter range.`
    );
  }
  return outPath;
}

const PROMPT = `You are analysing a short clip from a Hebrew-language webinar where the presenter demonstrates the Astria fashion-AI platform. The presenter speaks Hebrew but the UI is in English.

For this clip, produce a single JSON object (no markdown fences). Schema:

{
  "summary": string,                            // one paragraph: what the presenter demonstrates
  "urls_visible": string[],                     // every URL you can read in the browser URL bar, in order
  "ui_state": string,                           // the dominant on-screen view (e.g. "Lookbook cube grid expanded with jacket slot highlighted")
  "interactions": [                             // ordered list — every deliberate user action
    {
      "t": string,                              // approximate timestamp within the clip, e.g. "00:05"
      "action": "click"|"right-click"|"hover"|"type"|"scroll"|"drag"|"keypress"|"navigate",
      "target_text": string,                    // visible label of the element if any (e.g. "Remove Background")
      "target_description": string,             // plain-English description of the element
      "outcome": string                          // what visibly happens as a result
    }
  ],
  "notable_ui_affordances": string[],           // UI controls worth naming even if not interacted with
  "open_questions": string[]                    // anything ambiguous you couldn't determine from the video
}

Be precise about target_text — prefer exact visible strings so they can be used as Playwright selectors.
Be conservative: if you're unsure whether something was clicked vs hovered, say hover.
Never fabricate long URLs or long IDs. If a URL in the browser bar is unreadable or partially obscured, write "(unreadable)" rather than guessing characters.
Keep every string field under 200 characters. Keep the total response under 2000 words.
Respond with ONLY the JSON object.`;

interface InspectArgs {
  startTs: string;
  endTs: string;
  segmentId?: string;
  extraPrompt?: string;
}

export async function inspectWebinarSegment(args: InspectArgs): Promise<unknown> {
  const apiKey = process.env.VERTEX_API_KEY;
  if (!apiKey) throw new Error("VERTEX_API_KEY not set");
  if (!existsSync(WEBINAR)) throw new Error(`Webinar not found: ${WEBINAR}`);

  const start = tsToSec(args.startTs);
  const end = tsToSec(args.endTs);
  if (end <= start) throw new Error("end must be after start");
  const duration = end - start;

  console.log(`[gemini] chopping ${args.startTs} → ${args.endTs} (${duration}s)`);
  const clipPath = chopSegment(start, duration);
  const clipSize = statSync(clipPath).size;
  console.log(`[gemini] clip: ${clipPath} (${(clipSize / 1024 / 1024).toFixed(1)} MB)`);

  const inlineData = readFileSync(clipPath).toString("base64");
  const userPrompt = args.extraPrompt ? `${PROMPT}\n\nAdditional note: ${args.extraPrompt}` : PROMPT;

  const body = {
    contents: [
      {
        role: "user",
        parts: [
          { inline_data: { mime_type: "video/mp4", data: inlineData } },
          { text: userPrompt },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.1,
      responseMimeType: "application/json",
      maxOutputTokens: 16384,         // guard against runaway loops
    },
  };

  console.log(`[gemini] POST ${MODEL} (inline video ~${(clipSize / 1024 / 1024).toFixed(1)} MB)`);
  const res = await fetch(`${ENDPOINT}?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  if (!res.ok) {
    throw new Error(`Gemini HTTP ${res.status}: ${raw.slice(0, 800)}`);
  }

  const json = JSON.parse(raw) as {
    candidates?: Array<{ content: { parts: Array<{ text?: string }> }; finishReason?: string }>;
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  };
  const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = { _raw: text };
  }

  if (args.segmentId) {
    const out = join(ROOT, ".cache", "gemini", `${args.segmentId}.json`);
    writeFileSync(out, JSON.stringify(parsed, null, 2));
    console.log(`[gemini] wrote ${out}`);
  }

  const u = json.usageMetadata;
  if (u) {
    console.log(`[gemini] tokens: prompt=${u.promptTokenCount} out=${u.candidatesTokenCount}`);
  }

  return parsed;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [startTs, endTs, segmentId] = process.argv.slice(2);
  if (!startTs || !endTs) {
    console.error("Usage: tsx pipeline/gemini-inspect.ts <start hh:mm:ss> <end hh:mm:ss> [segment-id]");
    process.exit(1);
  }
  inspectWebinarSegment({ startTs, endTs, segmentId })
    .then((r) => console.log(JSON.stringify(r, null, 2)))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
