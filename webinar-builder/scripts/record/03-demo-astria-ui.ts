/**
 * Compiled from scripts/intent/03-explore-zara.yaml.
 *
 * Public page, no auth needed. Lands on the Zara Yellow Dress lookbook,
 * slowly scrolls through the gallery so the viewer can take in the
 * brand-consistent variations, settles near the bottom.
 *
 * Run headed: `HEADED=1 npx tsx pipeline/record-screencast.ts 03-demo-astria-ui`
 */
import type { RecordScript } from "../../pipeline/record-screencast.js";

const BASE_URL = process.env.ASTRIA_BASE_URL ?? "https://www.astria.ai";

async function glide(page: import("playwright").Page, x: number, y: number, steps = 25) {
  await page.mouse.move(x, y, { steps });
}

async function smoothScrollTo(
  page: import("playwright").Page,
  targetY: number,
  durationMs: number
) {
  await page.evaluate(
    async ({ targetY, durationMs }) => {
      const start = window.scrollY;
      const delta = targetY - start;
      const steps = Math.max(40, Math.floor(durationMs / 40));
      for (let i = 1; i <= steps; i++) {
        window.scrollTo({ top: start + (delta * i) / steps });
        await new Promise((r) => setTimeout(r, durationMs / steps));
      }
    },
    { targetY, durationMs }
  );
}

const script: RecordScript = async ({ page, sleep }) => {
  // ── Beat: land ────────────────────────────────────────────────────
  // astria.ai/p/<slug> is the real public pack URL pattern. The webinar
  // showed a Zara lookbook; here we use a representative fashion pack.
  const slug = process.env.ASTRIA_PACK_SLUG ?? "neutral-muse";
  await page.goto(`${BASE_URL}/p/${slug}`, { waitUntil: "domcontentloaded" });
  await sleep(2500);

  // Move cursor into the gallery area so the opening frame has a focal point
  const gallery = page.locator("main, [role=main], body").first();
  const box = await gallery.boundingBox().catch(() => null);
  if (box) await glide(page, box.x + box.width / 2, box.y + 240, 40);
  await sleep(500);

  // ── Beat: scroll-gallery ──────────────────────────────────────────
  await smoothScrollTo(page, 3400, 13000);

  // ── Beat: settle ──────────────────────────────────────────────────
  const tiles = page.locator("img").nth(6);   // hover some mid-page tile
  const tileBox = await tiles.boundingBox().catch(() => null);
  if (tileBox) {
    await glide(page, tileBox.x + tileBox.width / 2, tileBox.y + tileBox.height / 2, 30);
    await sleep(3500);
  } else {
    await sleep(3500);
  }
};

export default script;
