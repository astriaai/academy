// Face Inpainting intro Seedance2 generator.
//
// Important: the artboard is only a storyboard reference. Do not pass the
// 4x4 grid image as --input-image/--first-frame, or Seedance animates the grid
// itself. Instead, follow the artboard skill handoff:
//   - --text is shot 1 verbatim, so Nano Banana creates the opening frame.
//   - --video-prompt is the same 16-shot list, prefixed as a cinematic video.
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import "dotenv/config";

const ROOT = resolve(new URL("..", import.meta.url).pathname);
const promptPath = join(ROOT, "assets/avatars/face-inpainting/intro-artboard-prompt.txt");
const outputPath = join(ROOT, "assets/avatars/face-inpainting/00-intro-seedance.mp4");
const downloadDir = join(ROOT, "assets/avatars/face-inpainting/intro-video-download/seedance2");

const WORKSPACE_ID = process.env.WORKSPACE_ID ?? "553";
const VIDEO_MODEL = process.env.FACE_INPAINTING_INTRO_VIDEO_MODEL ?? "seedance2_720p";
const IMAGE_MODEL = process.env.FACE_INPAINTING_INTRO_IMAGE_MODEL ?? "nano-banana-2";
const DURATION = process.env.FACE_INPAINTING_INTRO_DURATION ?? "10";
const ASPECT_RATIO = "16:9";

function run(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, {
    cwd: ROOT,
    encoding: "utf-8",
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });
  if (result.status !== 0) {
    const detail = options.capture
      ? `\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
      : "";
    throw new Error(`${cmd} ${args.join(" ")} exited with ${result.status}${detail}`);
  }
  return result;
}

function parseJsonFromStdout(stdout) {
  const start = stdout.indexOf("{");
  const end = stdout.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error(`Could not find JSON in astria output:\n${stdout}`);
  }
  return JSON.parse(stdout.slice(start, end + 1));
}

function isMp4Container(filePath) {
  if (filePath.endsWith(".mp4")) {
    return true;
  }
  const header = readFileSync(filePath).subarray(4, 8).toString("utf-8");
  return header === "ftyp";
}

function newestVideoForPrompt(promptId) {
  const files = readdirSync(downloadDir)
    .filter((file) => file.startsWith(`prompt-${promptId}-`))
    .map((file) => join(downloadDir, file));
  if (files.length === 0) {
    throw new Error(`No downloaded files found for prompt ${promptId} in ${downloadDir}`);
  }
  const videos = files.filter(isMp4Container);
  if (videos.length === 0) {
    throw new Error(`No downloaded mp4 container found for prompt ${promptId} in ${downloadDir}`);
  }
  return videos.sort().at(-1);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getPrompt(promptId) {
  const result = run(
    "astria",
    ["prompts", "get", String(promptId), "--model", IMAGE_MODEL],
    { capture: true },
  );
  return parseJsonFromStdout(result.stdout);
}

async function waitForVideo(promptId) {
  const deadline = Date.now() + 30 * 60 * 1000;
  let tick = 0;
  while (Date.now() < deadline) {
    const prompt = getPrompt(promptId);
    if (prompt.user_error) {
      throw new Error(`Astria prompt ${promptId} errored: ${prompt.user_error}`);
    }
    const types = prompt.content_types ?? [];
    const videoIdx = types.findIndex((type) => type?.startsWith("video/"));
    if (videoIdx !== -1 && prompt.images?.[videoIdx]) {
      console.log(`[seedance2-intro] video ready on prompt ${promptId}`);
      return;
    }
    console.log(`[seedance2-intro] prompt ${promptId}: waiting for mp4 (tick ${tick++})`);
    await sleep(20_000);
  }
  throw new Error(`Timed out waiting for Seedance2 mp4 on prompt ${promptId}`);
}

async function main() {
  const shotList = readFileSync(promptPath, "utf-8").trim();
  const firstShot = shotList.split(/\n+/)[0].trim();
  const videoPrompt = `A cinematic video with the below video shots.\n${shotList}`;

  mkdirSync(downloadDir, { recursive: true });

  console.log(`[seedance2-intro] workspace=${WORKSPACE_ID}`);
  console.log(`[seedance2-intro] model=${VIDEO_MODEL}, first-frame model=${IMAGE_MODEL}, duration=${DURATION}s`);
  console.log(`[seedance2-intro] first frame: ${firstShot}`);

  let promptId = process.env.FACE_INPAINTING_INTRO_PROMPT_ID;
  if (promptId) {
    console.log(`[seedance2-intro] resuming existing prompt ${promptId}`);
  } else {
    console.log("[seedance2-intro] submitting video without artboard image input...");
    const video = run(
      "astria",
      [
        "video",
        "-w", WORKSPACE_ID,
        "--model", IMAGE_MODEL,
        "--resolution", "4K",
        "--text", firstShot,
        "--video-model", VIDEO_MODEL,
        "--video-prompt", videoPrompt,
        "--duration", DURATION,
        "--aspect-ratio", ASPECT_RATIO,
        "--num-images", "1",
        "--no-generate-audio",
        "--wait",
      ],
      { capture: true },
    );

    const prompt = parseJsonFromStdout(video.stdout);
    if (!prompt.id) {
      throw new Error(`Astria video response did not include an id:\n${video.stdout}`);
    }
    promptId = String(prompt.id);
    console.log(`[seedance2-intro] prompt id=${promptId}`);
  }

  await waitForVideo(promptId);
  run("astria", ["download", String(promptId), "--out", downloadDir]);
  const downloaded = newestVideoForPrompt(promptId);

  if (existsSync(outputPath)) {
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "");
    const backup = join(dirname(outputPath), `00-intro-seedance.previous-${stamp}.mp4`);
    renameSync(outputPath, backup);
    console.log(`[seedance2-intro] backed up previous intro -> ${basename(backup)}`);
  }

  copyFileSync(downloaded, outputPath);
  console.log(`[seedance2-intro] saved -> ${outputPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
