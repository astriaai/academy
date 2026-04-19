/**
 * Helpers for the DRAFT=1 build path — no paid APIs, still watchable.
 *
 *   1. Silent narration audio, sized from narration word count @ 155 wpm.
 *   2. Burn-in captions rendered as timed `<div class="cap">` elements that
 *      fade in on the segment timeline.
 *   3. No avatar MP4 is generated; the composition uses the placeholder cell.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { join } from "node:path";

export const DRAFT_WPM = 155;
export const DRAFT_MIN_SEGMENT_SECS = 8;
export const DRAFT_PAD_TAIL_SECS = 1.2;

export function wordCount(text: string): number {
  return (text.match(/\b[\w'-]+\b/g) ?? []).length;
}

export function draftDurationSec(narration: string): number {
  const words = wordCount(narration);
  const speakSecs = (words / DRAFT_WPM) * 60;
  return Math.max(DRAFT_MIN_SEGMENT_SECS, Math.ceil(speakSecs + DRAFT_PAD_TAIL_SECS));
}

function run(cmd: string, args: string[]) {
  const r = spawnSync(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
  if (r.status !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} failed: ${r.stderr.toString().slice(0, 400)}`);
  }
}

/**
 * Write a silent MP3 of the target duration.
 *
 * Cached — if the file exists with roughly the right length, reuse.
 */
export function ensureSilentNarration(rootDir: string, segmentId: string, durationSec: number): string {
  const dir = join(rootDir, "assets", "audio");
  mkdirSync(dir, { recursive: true });
  const out = join(dir, `${segmentId}.mp3`);
  if (existsSync(out)) {
    // Re-generate only if the duration has drifted (different narration → different length)
    const currentBytes = statSync(out).size;
    const expectedBytesApprox = durationSec * 8000;  // ~64 kbps silent mp3
    const withinTolerance = Math.abs(currentBytes - expectedBytesApprox) < expectedBytesApprox * 0.15;
    if (withinTolerance) return out;
  }
  run("ffmpeg", [
    "-y",
    "-f", "lavfi",
    "-i", `anullsrc=r=44100:cl=mono`,
    "-t", durationSec.toFixed(2),
    "-c:a", "libmp3lame",
    "-b:a", "64k",
    out,
  ]);
  return out;
}

/** Split narration into readable caption chunks of ~6-8 words each. */
export function splitIntoCaptions(narration: string): string[] {
  const cleaned = narration.replace(/\s+/g, " ").trim();
  // Primary split on sentence boundaries so chunks stay grammatical.
  const sentences = cleaned.split(/(?<=[.!?—])\s+/).filter(Boolean);
  const chunks: string[] = [];
  const targetWords = 8;
  for (const s of sentences) {
    const words = s.split(" ");
    if (words.length <= targetWords) {
      chunks.push(s);
      continue;
    }
    for (let i = 0; i < words.length; i += targetWords) {
      chunks.push(words.slice(i, i + targetWords).join(" "));
    }
  }
  return chunks;
}

export interface CaptionBeat {
  text: string;
  start: number;   // seconds
  duration: number;
}

/** Distribute chunks across the segment duration proportional to word count. */
export function buildCaptionBeats(narration: string, totalDuration: number): CaptionBeat[] {
  const chunks = splitIntoCaptions(narration);
  if (chunks.length === 0) return [];
  const totalWords = chunks.reduce((n, c) => n + wordCount(c), 0);
  const speakableSecs = Math.max(0.1, totalDuration - DRAFT_PAD_TAIL_SECS);
  let cursor = 0.2;  // tiny head pad so the first caption doesn't fire at t=0
  const beats: CaptionBeat[] = [];
  for (const c of chunks) {
    const share = (wordCount(c) / totalWords) * speakableSecs;
    const start = cursor;
    const duration = Math.max(0.6, share);
    beats.push({ text: c, start, duration });
    cursor += duration;
  }
  return beats;
}

/** Render caption beats as inline HTML + GSAP tweens that fade each chunk. */
export function renderCaptionsHtml(beats: CaptionBeat[]): { html: string; gsap: string } {
  if (beats.length === 0) return { html: "", gsap: "" };

  const html =
    `<div id="draft-captions" class="clip" data-start="0" data-duration="9999" data-track-index="9">` +
    beats
      .map(
        (b, i) =>
          `<div class="cap" id="cap-${i}" data-start="${b.start.toFixed(2)}" data-duration="${b.duration.toFixed(2)}">${b.text.replace(/</g, "&lt;")}</div>`
      )
      .join("") +
    `</div>`;

  const gsap = beats
    .map(
      (b, i) =>
        `tl.from("#cap-${i}", { opacity: 0, y: 18, duration: 0.35, ease: "power2.out" }, ${b.start.toFixed(2)});` +
        `tl.to("#cap-${i}", { opacity: 0, duration: 0.3, ease: "power1.in" }, ${(b.start + b.duration - 0.2).toFixed(2)});`
    )
    .join("\n      ");

  return { html, gsap };
}

export const DRAFT_CAPTIONS_CSS = `
  /* Draft-mode narration overlay — stacked at top-center so it never
     collides with slide/caption/PIP layout at the bottom of the canvas. */
  #draft-captions {
    position: absolute;
    top: 24px;
    left: 50%;
    transform: translateX(-50%);
    width: 1600px;
    max-width: 90%;
    display: flex;
    justify-content: center;
    z-index: 30;
    pointer-events: none;
  }
  #draft-captions .cap {
    position: absolute;
    top: 0;
    padding: 16px 30px;
    background: rgba(11, 11, 12, 0.78);
    backdrop-filter: blur(8px);
    color: #F4F1EC;
    font-family: "Inter", sans-serif;
    font-size: 28px;
    font-weight: 500;
    line-height: 1.22;
    letter-spacing: -0.01em;
    max-width: 1400px;
    text-align: center;
    border-radius: 10px;
    box-shadow: 0 16px 40px rgba(0,0,0,0.5);
    border: 1px solid rgba(224, 106, 78, 0.35);
  }
  #draft-captions .cap::before {
    content: "DRAFT · narration";
    position: absolute;
    top: -10px;
    left: 16px;
    font-size: 11px;
    letter-spacing: 0.3em;
    padding: 2px 8px;
    background: #E06A4E;
    color: #0B0B0C;
    border-radius: 3px;
    font-weight: 700;
  }
`;
