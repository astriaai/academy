/**
 * Compiled from scripts/intent/04-lookbook-references.yaml.
 *
 * FRONT-LOADED: the most demonstrative actions (click cube → type into note)
 * happen in the first ~25 s of wall-clock playback. A cube tour follows but
 * gets trimmed when the final video is scaled to the narration duration.
 *
 * Run headed: `HEADED=1 npx tsx pipeline/record-screencast.ts 04-lookbook-references`
 * Requires: storageState.json (run `npm run login` once).
 */
import type { RecordScript } from "../../pipeline/record-screencast.js";

const BASE_URL = process.env.ASTRIA_BASE_URL ?? "https://www.astria.ai";

async function glide(page: import("playwright").Page, x: number, y: number, steps = 20) {
  await page.mouse.move(x, y, { steps });
}

async function glideToSelector(
  page: import("playwright").Page,
  selector: string,
  { steps = 20, timeout = 2000, holdMs = 0 }: { steps?: number; timeout?: number; holdMs?: number } = {}
) {
  const el = await page.waitForSelector(selector, { state: "visible", timeout }).catch(() => null);
  if (!el) return false;
  const box = await el.boundingBox();
  if (!box) return false;
  await glide(page, box.x + box.width / 2, box.y + box.height / 2, steps);
  if (holdMs) await page.waitForTimeout(holdMs);
  return true;
}

async function clickCubeAndType(
  page: import("playwright").Page,
  cubeName: string,
  text: string | null,
  sleep: (ms: number) => Promise<void>
) {
  const cube = page.locator(`.cube-cell[data-lookbook-names-param="${cubeName}"]`).first();
  const box = await cube.boundingBox().catch(() => null);
  if (!box) return;
  await glide(page, box.x + box.width / 2, box.y + box.height / 2, 20);
  await sleep(250);
  await cube.click({ timeout: 2000 }).catch(() => {});
  await sleep(500);

  if (text) {
    const input = page
      .locator(
        `.cube-cell[data-lookbook-names-param="${cubeName}"] [data-lookbook-target="noteInput"]:not(.hidden) input, ` +
        `.cube-cell[data-lookbook-names-param="${cubeName}"] [data-lookbook-target="noteInput"]:not(.hidden) textarea`
      )
      .first();
    if (await input.count()) {
      await input.click({ timeout: 1500 }).catch(() => {});
      await input.fill("").catch(() => {});
      await input.type(text, { delay: 55 }).catch(() => {});
      await sleep(600);
    }
  }
}

const script: RecordScript = async ({ page, sleep }) => {
  // ── Land ────────────────────────────────────────────────────────────
  // No networkidle wait — Astria polls in the background.
  await page.goto(`${BASE_URL}/prompts`, { waitUntil: "domcontentloaded" });
  await sleep(2000);

  // ── Expand the cube grid ────────────────────────────────────────────
  await glideToSelector(page, ".lookbook-toggle", { holdMs: 300 });
  await page.locator(".lookbook-toggle").first().click({ timeout: 3000 }).catch(() => {});
  await sleep(1000);

  // ── Front-loaded interactions ───────────────────────────────────────
  // These are the clickable, visible-change moments most of the viewer
  // time will be spent on. Each one: glide → click cube → type a note.
  await clickCubeAndType(page, "face", "elegant woman", sleep);
  await clickCubeAndType(page, "jacket", "leather bomber", sleep);
  await clickCubeAndType(page, "pose", "45 degree angle", sleep);

  // ── Quick tour of the remaining cubes (trim target — earliest cut OK) ─
  for (const name of ["top", "bottom", "footwear", "background"]) {
    await glideToSelector(
      page,
      `.cube-cell[data-lookbook-names-param="${name}"]`,
      { steps: 20, timeout: 1200, holdMs: 450 }
    );
  }

  // ── End on the Describe button ──────────────────────────────────────
  const describe = page.getByRole("button", { name: /^Describe$/i }).first();
  if (await describe.count()) {
    const b = await describe.boundingBox();
    if (b) {
      await glide(page, b.x + b.width / 2, b.y + b.height / 2, 25);
      await sleep(800);
    }
  }
};

export default script;
