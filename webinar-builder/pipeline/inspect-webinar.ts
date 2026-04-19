/**
 * Extract keyframes from the original webinar MP4 at 2 s intervals across a
 * given timestamp range. Useful for grounding an intent YAML in what Alon
 * actually did in the recording.
 *
 *   tsx pipeline/inspect-webinar.ts 01:09:30 01:10:30
 *     → writes JPGs to .cache/webinar-frames/<start>-<end>/t-*.jpg
 *     → prints their paths
 *
 * Pipe the output of this into a Claude Code chat along with the intent
 * YAML to ground the compile step.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const WEBINAR = resolve(ROOT, "..", "astria-webinar.mp4");

function tsToSec(ts: string) {
  const [h, m, s] = ts.split(":").map(Number);
  return h * 3600 + m * 60 + s;
}
function secToTs(total: number) {
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = Math.floor(total % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function main() {
  const [startArg, endArg, intervalArg] = process.argv.slice(2);
  if (!startArg || !endArg) {
    console.error("Usage: tsx pipeline/inspect-webinar.ts <start hh:mm:ss> <end hh:mm:ss> [interval_s=2]");
    process.exit(1);
  }
  if (!existsSync(WEBINAR)) {
    console.error(`Webinar not found: ${WEBINAR}`);
    process.exit(1);
  }
  const start = tsToSec(startArg);
  const end = tsToSec(endArg);
  const interval = intervalArg ? Number(intervalArg) : 2;
  if (end <= start) throw new Error("end must be after start");

  const tag = `${startArg.replace(/:/g, "")}-${endArg.replace(/:/g, "")}`;
  const outDir = join(ROOT, ".cache", "webinar-frames", tag);
  mkdirSync(outDir, { recursive: true });

  console.log(`Extracting frames ${startArg} → ${endArg} every ${interval}s`);
  for (let t = start; t <= end; t += interval) {
    const file = join(outDir, `t-${secToTs(t).replace(/:/g, "_")}.jpg`);
    if (existsSync(file)) continue;
    const r = spawnSync(
      "ffmpeg",
      ["-y", "-ss", secToTs(t), "-i", WEBINAR, "-frames:v", "1", "-q:v", "3", "-vf", "scale=1280:-1", file],
      { stdio: "ignore" }
    );
    if (r.status !== 0) console.warn(`skip ${secToTs(t)}: ffmpeg error`);
  }

  const files = readdirSync(outDir).filter((f) => f.endsWith(".jpg")).sort();
  console.log(`\nExtracted ${files.length} frames to ${outDir}:`);
  for (const f of files) console.log(`  ${join(outDir, f)}`);
}

main();
