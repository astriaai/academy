/**
 * Compiled for scripts/intent/3d-packshots/02-workflow.yaml.
 *
 * Walks the Astria 3D-packshot upload flow on https://www.astria.ai/p/backpack.
 *
 * Astria UI surface (educated guesses — verify on first headed run and refine):
 *   - File input:           input[type='file']         (hidden, drives uploads)
 *   - Upload trigger btn:   [data-action*='triggerFile'] OR :has-text('Upload')
 *   - Generate button:      button:has-text('Generate'), button[type='submit']
 *
 * Narration anchors (~40s total):
 *    0.0 s  land on /p/backpack
 *    4.0 s  "Every pack has a built-in upload"
 *   10.0 s  "Drop in any product photo — even a messy phone snap"
 *   24.0 s  "One click and it queues — a clean studio rotation plus multi-angle stills"
 *   34.0 s  "One image in, an editorial-grade packshot out"
 *   40.0 s  end (do NOT click Generate)
 *
 * Run headed (recommended for first capture so you can see what's happening):
 *   HEADED=1 npx tsx pipeline/record-screencast.ts --project 3d-packshots 02-workflow
 */
import type { RecordScript } from "../../../pipeline/record-screencast.js";
import { resolve } from "node:path";

const BASE_URL = process.env.ASTRIA_UI_URL ?? "https://www.astria.ai";

const REF_IMAGE_PATH = resolve(
  process.cwd(),
  "assets/results/3d-packshots/ref-backpack-blue-ugly.jpg",
);

async function glide(page: import("playwright").Page, x: number, y: number, steps = 18) {
  await page.mouse.move(x, y, { steps });
}

async function hoverFirst(
  page: import("playwright").Page,
  candidates: string[],
  sleep: (ms: number) => Promise<void>,
  perTimeoutMs = 600,
): Promise<boolean> {
  for (const sel of candidates) {
    const el = page.locator(sel).first();
    const box = await el.boundingBox({ timeout: perTimeoutMs }).catch(() => null);
    if (!box) continue;
    await glide(page, box.x + box.width / 2, box.y + box.height / 2, 16);
    await sleep(120);
    return true;
  }
  return false;
}

const script: RecordScript = async ({ page, sleep }) => {
  // ── Beat 1 — Land ────────────────────────────────────────────────
  // "Open the 3D-packshot template inside Astria." @0 → 4
  await page.goto(`${BASE_URL}/p/backpack`, { waitUntil: "domcontentloaded" });
  await sleep(2500);                              // page settles — ≈ t=2.5

  // Park the cursor mid-canvas so the entry feels intentional.
  await glide(page, 700, 500, 12);
  await sleep(1500);                              // ≈ t=4

  // ── Beat 2 — Hover the upload affordance ─────────────────────────
  // "Every pack has a built-in upload" @4 → 10
  await hoverFirst(
    page,
    [
      `[data-action*='triggerFile']`,
      `button:has-text('Upload')`,
      `label:has-text('Upload')`,
      `.image-input`,
      `input[type='file']`,
    ],
    sleep,
  );
  await sleep(6000);                              // hold — ≈ t=10

  // ── Beat 3 — Upload the iPhone-style messy reference ─────────────
  // "Drop in any product photo — even a messy phone snap." @10 → 24
  //
  // Astria's upload is typically a hidden <input type='file'>; setInputFiles
  // works directly without needing to click the trigger button. If the page
  // requires the trigger click first to mount the input, fall back to that.
  let uploaded = false;
  try {
    await page
      .locator("input[type='file']")
      .first()
      .setInputFiles(REF_IMAGE_PATH, { timeout: 4000 });
    uploaded = true;
  } catch (e) {
    console.warn(`[record] direct setInputFiles failed: ${(e as Error).message}`);
  }
  if (!uploaded) {
    // Try clicking the trigger first, then any newly-mounted file input.
    await page
      .locator(`[data-action*='triggerFile'], button:has-text('Upload')`)
      .first()
      .click({ timeout: 2000 })
      .catch(() => {});
    await sleep(800);
    await page
      .locator("input[type='file']")
      .last()
      .setInputFiles(REF_IMAGE_PATH, { timeout: 4000 })
      .catch((e) =>
        console.warn(`[record] fallback setInputFiles failed: ${(e as Error).message}`),
      );
  }
  await sleep(13000);                             // preview lingers — ≈ t=24

  // ── Beat 4 — Hover Generate (do NOT click) ───────────────────────
  // "One click and it queues — clean rotation + stills." @24 → 34
  const generateHovered = await hoverFirst(
    page,
    [
      `button:has-text('Generate')`,
      `input[type='submit'][value*='Generate']`,
      `button[type='submit']`,
      `input[type='submit']`,
    ],
    sleep,
    1000,
  );
  if (!generateHovered) {
    console.warn("[record] Generate button not located — settling without highlight.");
  }
  await sleep(10000);                             // hold — ≈ t=34

  // ── Beat 5 — Settle on ready-to-fire ─────────────────────────────
  // "One image in, an editorial-grade packshot out." @34 → 40
  await sleep(6000);                              // ≈ t=40 — end
};

export default script;
