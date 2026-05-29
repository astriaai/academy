import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import "dotenv/config";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const BASE_URL = process.env.ASTRIA_UI_URL ?? "https://www.astria.ai";
const WORKSPACE_ID = process.env.WORKSPACE_ID ?? "553";
const MODEL_TUNE_ID = process.env.GEMINI_TUNE_ID ?? "4180298";
const OUT_DIR = process.env.OUT_DIR ?? "assets/results/face-inpainting/ws-553";

const [promptId, label, imageIndexArg] = process.argv.slice(2);
if (!promptId || !label) {
  console.error("Usage: tsx scripts/extract-face-inpainting-layers.ts <prompt-id> <label> [image-index]");
  process.exit(1);
}

const imageIndex = Number(imageIndexArg ?? "1");
if (!Number.isInteger(imageIndex) || imageIndex < 0) {
  throw new Error(`Invalid image index: ${imageIndexArg}`);
}

function extensionFor(contentType: string | null, url: string) {
  if (contentType?.includes("png")) return ".png";
  if (contentType?.includes("webp")) return ".webp";
  if (contentType?.includes("jpeg") || contentType?.includes("jpg")) return ".jpg";
  const ext = extname(new URL(url).pathname);
  return ext || ".jpg";
}

async function main() {
  const storageStatePath = join(ROOT, "storageState.json");
  const browser = await chromium.launch({ headless: process.env.HEADED !== "1" });
  const context = await browser.newContext({
    viewport: { width: 1600, height: 900 },
    deviceScaleFactor: 2,
    colorScheme: "dark",
    ...(existsSync(storageStatePath) ? { storageState: storageStatePath } : {}),
  });
  const page = await context.newPage();

  const promptUrl = `${BASE_URL}/tunes/${MODEL_TUNE_ID}/prompts/${promptId}?ws=${WORKSPACE_ID}`;
  await page.goto(promptUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.locator("a.prompt-image").first().waitFor({ state: "visible", timeout: 60_000 });
  await page.waitForTimeout(800);

  const items = await page.locator("a.prompt-image").evaluateAll((anchors) =>
    anchors.map((anchor) => {
      const a = anchor as HTMLAnchorElement;
      const img = a.querySelector("img") as HTMLImageElement | null;
      return {
        href: a.href,
        src: img?.src || a.href,
        debugUrl: a.getAttribute("data-lightbox-debug-url"),
      };
    }),
  );

  const item = items[imageIndex];
  if (!item) throw new Error(`Prompt ${promptId} has ${items.length} images; index ${imageIndex} does not exist`);
  if (!item.debugUrl) throw new Error(`Prompt ${promptId} image ${imageIndex} has no lightbox debug URL`);

  const layers = await page.evaluate(async (debugUrl) => {
    const res = await fetch(debugUrl, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`debug layer request failed: ${res.status}`);
    return res.json() as Promise<Array<{ src: string; label: string }>>;
  }, item.debugUrl);

  const rawLayer = layers.find((layer) => /original/i.test(layer.label)) ?? layers[0];
  if (!rawLayer?.src) throw new Error(`Prompt ${promptId} image ${imageIndex} has no original/debug layer`);

  const outDir = join(ROOT, OUT_DIR);
  mkdirSync(outDir, { recursive: true });

  async function download(kind: "final" | "raw", url: string) {
    const res = await context.request.get(url);
    if (!res.ok()) throw new Error(`Download failed for ${kind}: ${res.status()} ${url}`);
    const contentType = res.headers()["content-type"] ?? null;
    const ext = extensionFor(contentType, url);
    const path = join(outDir, `${label}-${kind}-source${ext}`);
    writeFileSync(path, await res.body());
    return path;
  }

  const finalPath = await download("final", item.src);
  const rawPath = await download("raw", rawLayer.src);
  const metaPath = join(outDir, `${label}-layers.json`);
  writeFileSync(
    metaPath,
    JSON.stringify(
      {
        promptId,
        promptUrl,
        imageIndex,
        final: item.src,
        raw: rawLayer,
        layers,
        files: { final: finalPath, raw: rawPath },
      },
      null,
      2,
    ),
  );

  await browser.close();
  console.log(`[layers] ${label}: final=${finalPath}`);
  console.log(`[layers] ${label}: raw=${rawPath}`);
  console.log(`[layers] ${label}: meta=${metaPath}`);
}

main().catch(async (error) => {
  console.error(error);
  process.exit(1);
});
