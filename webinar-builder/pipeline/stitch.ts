/**
 * Concat all per-segment MP4s in the order declared in script/webinar.yaml
 * into a single reviewable draft: out/_full-draft.mp4
 *
 *   tsx pipeline/stitch.ts
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

function main() {
  const webinar = yaml.load(readFileSync(join(ROOT, "script", "webinar.yaml"), "utf-8")) as {
    segments: string[];
  };

  const clips: string[] = [];
  const missing: string[] = [];
  for (const id of webinar.segments) {
    const p = join(ROOT, "out", `${id}.mp4`);
    if (existsSync(p)) clips.push(p);
    else missing.push(id);
  }
  if (missing.length) {
    console.warn(`[stitch] skipping missing: ${missing.join(", ")}`);
  }
  if (clips.length === 0) throw new Error("nothing to stitch");

  mkdirSync(join(ROOT, "out"), { recursive: true });
  const listPath = join(ROOT, "out", "_concat.txt");
  writeFileSync(listPath, clips.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n"));

  const outPath = join(ROOT, "out", "_full-draft.mp4");

  // Two-pass: re-encode for safety (segments may have different keyframe spacings).
  const r = spawnSync(
    "ffmpeg",
    [
      "-y",
      "-f", "concat",
      "-safe", "0",
      "-i", listPath,
      "-c:v", "libx264",
      "-crf", "22",
      "-preset", "fast",
      "-c:a", "aac",
      "-b:a", "128k",
      "-movflags", "+faststart",
      outPath,
    ],
    { stdio: "inherit" }
  );
  if (r.status !== 0) throw new Error("ffmpeg concat failed");

  console.log(`\n[stitch] ${clips.length} clips → ${outPath}`);
}

main();
