import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import "dotenv/config";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const BASE_URL = process.env.ASTRIA_UI_URL ?? "https://www.astria.ai";
const WORKSPACE_ID = process.env.WORKSPACE_ID ?? "553";
const OUT_DIR = process.env.OUT_DIR ?? "assets/results/face-inpainting/ws-553";
const LIMIT = Number(process.env.LIMIT ?? "4");

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
  const url = `${BASE_URL}/prompts?ws=${WORKSPACE_ID}&inpaint_faces=true&limit=80`;
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.locator("a.prompt-image").first().waitFor({ state: "visible", timeout: 60_000 });
  await page.waitForTimeout(1200);

  const cards = await page.locator("a.prompt-image").evaluateAll((anchors) =>
    anchors.map((anchor, index) => {
      const a = anchor as HTMLAnchorElement;
      const img = a.querySelector("img") as HTMLImageElement | null;
      const promptFrame = a.closest("[data-prompt-id]") as HTMLElement | null;
      return {
        index,
        promptId: promptFrame?.dataset.promptId || "",
        src: img?.src || a.href,
        debugUrl: a.getAttribute("data-lightbox-debug-url") || "",
        meta: promptFrame?.querySelector(".prompt-meta")?.textContent?.replace(/\s+/g, " ").trim() || "",
      };
    }),
  );

  const outDir = join(ROOT, OUT_DIR);
  mkdirSync(outDir, { recursive: true });
  const found: Array<Record<string, unknown>> = [];

  for (const card of cards) {
    if (found.length >= LIMIT) break;
    if (!card.debugUrl || !card.promptId) continue;
    const layers = await page.evaluate(async (debugUrl) => {
      const res = await fetch(debugUrl, { headers: { Accept: "application/json" } });
      if (!res.ok) return [];
      return res.json() as Promise<Array<{ src: string; label: string }>>;
    }, card.debugUrl).catch(() => []);
    const original = layers.find((layer) => /original/i.test(layer.label));
    if (!original?.src) continue;

    const label = `prompt-${card.promptId}`;
    async function download(kind: "final" | "raw", src: string) {
      const res = await context.request.get(src);
      if (!res.ok()) throw new Error(`Download failed ${res.status()} ${src}`);
      const ext = extensionFor(res.headers()["content-type"] ?? null, src);
      const file = join(outDir, `${label}-${kind}-source${ext}`);
      writeFileSync(file, await res.body());
      return file;
    }

    const finalFile = await download("final", card.src);
    const rawFile = await download("raw", original.src);
    const item = {
      promptId: card.promptId,
      index: card.index,
      promptUrl: `${BASE_URL}/tunes/4180298/prompts/${card.promptId}?ws=${WORKSPACE_ID}`,
      final: card.src,
      original,
      layers,
      files: { final: finalFile, raw: rawFile },
      meta: card.meta,
    };
    writeFileSync(join(outDir, `${label}-layers.json`), JSON.stringify(item, null, 2));
    found.push(item);
    console.log(`[layers] ${label}: ${original.label}`);
  }

  await browser.close();
  console.log(JSON.stringify({ found: found.length, prompts: found.map((item) => item.promptId) }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
