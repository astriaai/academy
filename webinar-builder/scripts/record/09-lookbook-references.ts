/**
 * Compiled for scripts/intent/09-lookbook-references.yaml.
 *
 * Walk through the Lookbook builder one cube at a time, then hover the
 * technicality controls. Timings are locked to the Gemini/Aoede narration.
 *
 * Narration anchors (≈49 s):
 *    0.0 s  "click the Lookbook button"
 *    2.9 s  "start adding references"
 *    5.78 s "Pose"
 *    9.32 s "Face"
 *   14.24 s "Top"
 *   17.60 s "Bottom"
 *   20.24 s "Footwear"
 *   23.99 s "technicalities"
 *   27.53 s "Nano Banana"
 *   30.36 s "Resolution: 2K"
 *   37.42 s "Aspect ratio 3:4"
 *   44.07 s "images per prompt"
 *   48.81 s end
 *
 * Run headed: `HEADED=1 npx tsx pipeline/record-screencast.ts 09-lookbook-references`
 * Requires: a fresh storageState.json (run `npm run login` once; cookies
 * expire after ~30 days — if the capture lands on Sign in, that's stale auth).
 *
 * Timing discipline:
 *   Every locator must fail FAST (≤500 ms). A missed selector times out
 *   into the narration budget otherwise; a prior pass overran 160 s on
 *   a 49 s track that way.
 */
import type { RecordScript } from "../../pipeline/record-screencast.js";

const BASE_URL = process.env.ASTRIA_BASE_URL ?? "https://www.astria.ai";

async function glide(page: import("playwright").Page, x: number, y: number, steps = 20) {
  await page.mouse.move(x, y, { steps });
}

/**
 * Locate a cube by either the data attribute (legacy selector) OR by the
 * visible label text. Returns the first locator that's actually visible.
 */
function cubeLocator(
  page: import("playwright").Page,
  name: string,
  label: string
) {
  return page
    .locator(
      `.cube-cell[data-lookbook-names-param="${name}"], ` +
      `[data-lookbook-names-param="${name}"], ` +
      `div[role="button"]:has(> :text-is("${label}")), ` +
      `div:has(> h3:text-is("${label}")), ` +
      `div:has(> * > :text-is("${label}"))`
    )
    .first();
}

/**
 * Hover-only cube visit. Tried clicking into the picker and picking a row
 * for several passes — the picker takes non-trivial time to load, closing
 * it without cancelling the selection proved fragile, and stacked timeouts
 * overran the narration budget repeatedly. A clean hover with a small
 * cursor wiggle reads well on camera and keeps timing tight.
 */
async function visitCube(
  page: import("playwright").Page,
  name: string,
  label: string,
  _rowIndex: number,
  sleep: (ms: number) => Promise<void>
) {
  const cube = cubeLocator(page, name, label);
  const box = await cube.boundingBox({ timeout: 600 }).catch(() => null);
  if (!box) return;

  // Glide in, pause, wiggle slightly so the highlight lingers.
  await glide(page, box.x + box.width / 2, box.y + box.height / 2, 18);
  await sleep(350);
  await glide(page, box.x + box.width / 2 + 14, box.y + box.height / 2 - 8, 8);
  await sleep(250);
}

/**
 * Hover an element by visible text, fast-fail if not present. Tries a broad
 * set of roles/tags because Astria's settings row is a mix of native
 * <button>, role=button divs, and dropdown triggers.
 */
async function hoverByText(
  page: import("playwright").Page,
  text: string,
  holdMs = 400
) {
  // getByText is the most forgiving: it matches any element containing the
  // visible string and climbs to clickable ancestors. Try it first, then
  // fall back to explicit role selectors.
  const candidates = [
    page.getByText(text, { exact: false }).first(),
    page.locator(`button:has-text("${text}")`).first(),
    page.locator(`[role="button"]:has-text("${text}")`).first(),
    page.locator(`[role="combobox"]:has-text("${text}")`).first(),
    page.locator(`summary:has-text("${text}")`).first(),
    page.locator(`details:has-text("${text}")`).first(),
  ];
  for (const el of candidates) {
    const box = await el.boundingBox({ timeout: 300 }).catch(() => null);
    if (!box) continue;
    await glide(page, box.x + box.width / 2, box.y + box.height / 2, 16);
    await page.waitForTimeout(holdMs);
    return true;
  }
  return false;
}

const script: RecordScript = async ({ page, sleep }) => {
  // ── Land + open the Lookbook helper ─────────────────────────────────
  await page.goto(`${BASE_URL}/prompts`, { waitUntil: "domcontentloaded" });
  await sleep(1200);

  // Narration: "click the Lookbook button and start adding references"
  // Try the legacy toggle (".lookbook-toggle") and the modern Lookbook tab.
  const toggle = page.locator(
    `.lookbook-toggle, button:has-text("Lookbook"), [role="tab"]:has-text("Lookbook")`
  ).first();
  const tbox = await toggle.boundingBox({ timeout: 500 }).catch(() => null);
  if (tbox) {
    await glide(page, tbox.x + tbox.width / 2, tbox.y + tbox.height / 2, 14);
    await sleep(250);
    await toggle.click({ timeout: 800 }).catch(() => {});
  }
  await sleep(2300);                                 // ≈ t=4.5 — grid visible

  // ── Cube tour, narration-paced ─────────────────────────────────────
  // "Pose" @ 5.78
  await visitCube(page, "pose", "Pose", 2, sleep);
  await sleep(2300);                                 // ≈ t=9.3

  // "Face" @ 9.32
  await visitCube(page, "face", "Face", 1, sleep);
  await sleep(3200);                                 // ≈ t=14.3

  // "Top" @ 14.24
  await visitCube(page, "top", "Top", 0, sleep);
  await sleep(1700);                                 // ≈ t=17.6

  // "Bottom" @ 17.6
  await visitCube(page, "bottom", "Bottom", 1, sleep);
  await sleep(1300);                                 // ≈ t=20.3

  // "Footwear" @ 20.24
  await visitCube(page, "footwear", "Footwear", 0, sleep);
  await sleep(2700);                                 // ≈ t=24 — "technicalities"

  // ── Technicalities row ────────────────────────────────────────────
  // The settings row (model / aspect / resolution / count) lives below the
  // expanded cube grid — scroll it into view before hovering, and make
  // sure the row element is actually visible. If Playwright's scrollIntoView
  // on the first settings control works we stay aligned; otherwise fall
  // back to a raw window.scrollTo.
  await page.evaluate(() => {
    const sel = '[class*="model"] button, button[aria-haspopup], form [role="combobox"]';
    const el = document.querySelector<HTMLElement>(sel);
    if (el) el.scrollIntoView({ block: "center", behavior: "instant" as ScrollBehavior });
    else window.scrollTo({ top: document.body.scrollHeight, behavior: "instant" as ScrollBehavior });
  }).catch(() => {});
  await sleep(400);

  // "Nano Banana 2" @ 27.53 — hover the model selector. Full label is
  // "Nano Banana 2 - Gemini 3.1 Flash Image Previ…"; partial match works.
  await hoverByText(page, "Nano Banana", 400);
  await sleep(2200);                                 // ≈ t=30

  // "Resolution: 2K" @ 30.36. The current resolution may display as "1K";
  // try 1K first (current default), then 2K in case the build already
  // bumped it.
  const resOk = await hoverByText(page, "1K", 400);
  if (!resOk) await hoverByText(page, "2K", 400);
  await sleep(5500);                                 // ≈ t=37

  // "Aspect ratio 3:4" @ 37.42 — held ~5.5s
  await hoverByText(page, "3:4", 400);
  await sleep(5500);                                 // ≈ t=43.5

  // "images per prompt" @ 44.07 — the count selector is a small dropdown
  // showing just the number (e.g. "4"). Target the dropdown icon row by
  // walking through the common labels.
  let ok = await hoverByText(page, "Images per prompt", 400);
  if (!ok) ok = await hoverByText(page, "per prompt", 400);
  if (!ok) ok = await hoverByText(page, "image", 400);
  await sleep(4500);                                 // ≈ t=48.5
};

export default script;
