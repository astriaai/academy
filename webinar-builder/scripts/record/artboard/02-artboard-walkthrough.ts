/**
 * Astria Artboard walkthrough, part 1: workspace → references → template prompts.
 *
 * Drives the demo account through the "America Basics" workspace (ws=54) to
 * teach the artboard setup: it presents the workspace, its cast and wardrobe,
 * then shows the worked prompts each template already holds. It intentionally
 * stops before the AI assistant so this prep segment can be re-recorded
 * without triggering a paid `/artboard` generation.
 *
 * Astria UI surface (verified live, May 2026 — ws=54):
 *   - Templates list:      /packs?ws=54
 *       · template card:   a.cover-img-wrap[href^='/p/<slug>']
 *                          (basic-pants2 → 4051, basic-jacket-men → 4045,
 *                           basic-shirt → 4036)
 *   - References (tunes):  /tunes?ws=54
 *       · tune card:       turbo-frame[id^='tune_<id>']  (h2.card-title inside)
 *       · cast faceids:    Hazel 3982728 · Autumn 3979589 · Damien 3979439
 *       · Filters control: daisyUI focus-dropdown — a <div role="button">
 *                          labelled "Filters" (NOT a <button>). Focusing it
 *                          reveals ul.dropdown-content; under "Class" the
 *                          Human / Garment / Background options are <a> links
 *                          (href carries class_type=…). Clicking one navigates
 *                          to /tunes?class_type=<value>&ws=54.
 *   - Pack prompts:        /prompts?pack_id=<id>&ws=54
 *       · prompt card:     turbo-frame.prompt   ·   text/tunes panel: .meta
 *   - AI assistant toggle: a.btn.btn-primary[aria-label='AI assistant']
 *   - Chat panel:          div#chat-widget.chat-sidebar
 *   - Chat composer:       textarea.aui-composer-input
 *   - Skill menu:          typing '/' opens it; '/artboard' is the first item,
 *                          rendered as a <button> inside #chat-widget.
 *
 * Narration anchors (~75s total — approximate; the build paces narration to
 * the real capture):
 *    0.0 s  land on /packs?ws=54
 *    3.0 s  "This is the America Basics workspace — three product templates."
 *   10.0 s  open /tunes — "References."
 *   14.0 s  Filters → Human — tour the cast
 *   24.0 s  Filters → Garment — tour the wardrobe
 *   35.0 s  open the Basic shirt prompts
 *   44.0 s  open the Basic Jacket prompts
 *   53.0 s  open the Basic Pants prompts
 *   64.0 s  end on the final worked prompt
 *
 * Auth: replays storageState.json — that session must be the demo account
 * the America Basics workspace (ws=54) is shared with.
 *
 * Run headed:
 *   HEADED=1 npx tsx pipeline/record-screencast.ts --project artboard 02-artboard-walkthrough
 */
import type { RecordScript } from "../../../pipeline/record-screencast.js";

// UI hostname — ASTRIA_BASE_URL is the API URL (returns JSON on /prompts).
// The recorder always drives the browser UI.
const BASE_URL = process.env.ASTRIA_UI_URL ?? "https://www.astria.ai";

// The America Basics workspace, shared with the demo account.
const WS = "54";

// Pack ids for the three templates (verified live on /packs?ws=54).
const PACK_SHIRT = "4036"; // Basic shirt  — Hazel (girl)
const PACK_JACKET = "4045"; // Basic Jacket — Damien (man)
const PACK_PANTS = "4051"; // Basic Pants  — Autumn (woman)

// The cast tunes, toured on the References page.
const TUNE_HAZEL = "3982728"; // girl
const TUNE_AUTUMN = "3979589"; // woman
const TUNE_DAMIEN = "3979439"; // man

// ── Human-like cursor motion ─────────────────────────────────────────────
// The recorder's synthetic cursor is repositioned directly on every
// `mousemove` with `transition:none` — so smooth motion has to be built into
// the move itself: many intermediate positions, eased, and spread over real
// time. Playwright's built-in `mouse.move` `steps` are linear and fire too
// fast to register across the 25fps capture.

/** Cubic ease-in-out — slow start, quick middle, gentle stop. */
function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

// Last known cursor position. Playwright exposes no getter for the mouse, so
// eased moves track it themselves. Starts at the viewport origin (Playwright's
// default) — the first glide sweeps in from the top-left corner.
let cursorX = 0;
let cursorY = 0;

/**
 * Glide the synthetic cursor to (x, y) the way a hand moves a mouse:
 * accelerating out of the start, decelerating into the target. The path is
 * interpolated through easeInOutCubic and its substeps are spaced over real
 * time (~0.7 ms per pixel, clamped to a 220–760 ms move) so the motion reads
 * as smooth at 25fps. Substep count scales with distance — short hops stay
 * snappy, long sweeps stay fluid.
 */
async function glide(
  page: import("playwright").Page,
  x: number,
  y: number,
): Promise<void> {
  const fromX = cursorX;
  const fromY = cursorY;
  const dist = Math.hypot(x - fromX, y - fromY);
  cursorX = x;
  cursorY = y;
  if (dist < 1.5) {
    await page.mouse.move(x, y);
    return;
  }
  const steps = Math.max(12, Math.min(64, Math.round(dist / 9)));
  const durationMs = Math.max(220, Math.min(760, dist * 0.7));
  const perStepMs = durationMs / steps;
  for (let i = 1; i <= steps; i++) {
    const t = easeInOutCubic(i / steps);
    await page.mouse.move(fromX + (x - fromX) * t, fromY + (y - fromY) * t);
    await page.waitForTimeout(perStepMs);
  }
}

/**
 * Close any dismissible top banners (announcement strips, "verify email",
 * upgrade nudges, …). Tolerant — no-op when none are present. Call after
 * every navigation. Pattern shared with the other recorder scripts.
 */
async function dismissBanners(
  page: import("playwright").Page,
  sleep: (ms: number) => Promise<void>,
): Promise<void> {
  await sleep(400); // the strip lazy-renders after DOMContentLoaded
  const closed = await page
    .evaluate(() => {
      const out: string[] = [];
      const banners = Array.from(
        document.querySelectorAll<HTMLElement>(
          [
            "[data-announcement-banner]",
            ".alert",
            ".banner",
            "[role='alert']",
            "[class*='announce' i]",
            "[class*='notification' i]",
            "[class*='toast' i]",
            "[class*='flash' i]",
          ].join(","),
        ),
      );
      for (const b of banners) {
        const cs = getComputedStyle(b);
        if (cs.display === "none" || cs.visibility === "hidden") continue;
        const closeBtn =
          b.querySelector<HTMLElement>(
            "button[aria-label*='close' i], button.btn-ghost.btn-xs, button.btn-circle, .close, [data-action*='close']",
          ) ??
          Array.from(b.querySelectorAll<HTMLElement>("button")).find((el) =>
            /^[×x✕✖]\s*$/i.test((el.textContent || "").trim()),
          ) ??
          null;
        if (closeBtn) {
          closeBtn.click();
          out.push(b.className.slice(0, 60) || b.tagName);
        } else if (b.matches("[data-announcement-banner]")) {
          b.remove();
          out.push(`removed:${b.className.slice(0, 40)}`);
        }
      }
      return out;
    })
    .catch(() => [] as string[]);
  if (closed.length) {
    console.log(`[record] dismissed banners: ${closed.join(" | ")}`);
    await sleep(250);
  }
}

/** Glide to the first matching selector and click it. Returns false if none hit. */
async function clickFirst(
  page: import("playwright").Page,
  candidates: string[],
  sleep: (ms: number) => Promise<void>,
  perTimeoutMs = 600,
): Promise<boolean> {
  for (const sel of candidates) {
    const el = page.locator(sel).first();
    const box = await el.boundingBox({ timeout: perTimeoutMs }).catch(() => null);
    if (!box) continue;
    await glide(page, box.x + box.width / 2, box.y + box.height / 2);
    await sleep(180);
    await el.click({ timeout: 800 }).catch(() => {});
    return true;
  }
  return false;
}

/**
 * Glide the synthetic cursor across a list of elements, pausing on each — the
 * "look at these" gesture. Missing selectors are skipped silently so the tour
 * degrades gracefully if the UI shifts.
 */
async function cursorTour(
  page: import("playwright").Page,
  selectors: string[],
  sleep: (ms: number) => Promise<void>,
  perMs = 1600,
): Promise<void> {
  for (const sel of selectors) {
    const box = await page
      .locator(sel)
      .first()
      .boundingBox({ timeout: 800 })
      .catch(() => null);
    if (!box) continue;
    await glide(page, box.x + box.width / 2, box.y + box.height / 2);
    await sleep(perMs);
  }
}

/** Like cursorTour, but glides across the Nth matches of one selector. */
async function cursorTourNth(
  page: import("playwright").Page,
  selector: string,
  indices: number[],
  sleep: (ms: number) => Promise<void>,
  perMs = 1600,
): Promise<void> {
  for (const i of indices) {
    const box = await page
      .locator(selector)
      .nth(i)
      .boundingBox({ timeout: 800 })
      .catch(() => null);
    if (!box) continue;
    await glide(page, box.x + box.width / 2, box.y + box.height / 2);
    await sleep(perMs);
  }
}

/**
 * On /tunes: open the Filters dropdown and click a Class option, filtering the
 * reference list. The Filters control is a daisyUI focus-dropdown — a
 * <div role="button"> trigger that reveals ul.dropdown-content when focused
 * (it is NOT a <button> tag). The Class options (Human / Garment / Background)
 * are <a> links inside it whose href carries class_type=<value>; clicking one
 * navigates to /tunes?class_type=<value>&ws=54.
 */
async function openClassFilter(
  page: import("playwright").Page,
  classType: "human" | "garment" | "background",
  sleep: (ms: number) => Promise<void>,
): Promise<void> {
  // Visible gesture — glide the cursor onto the Filters control and click it.
  await clickFirst(
    page,
    [
      `.filters [role='button']:has-text('Filters')`,
      `[role='button']:has-text('Filters')`,
    ],
    sleep,
  );
  await sleep(500);
  // Guarantee the daisyUI dropdown is open by focusing its trigger — a bare
  // click can blur before the focus-driven menu commits.
  await page
    .evaluate(() => {
      const trig = Array.from(
        document.querySelectorAll<HTMLElement>(".dropdown [role='button']"),
      ).find((e) => /Filters/.test(e.textContent || ""));
      trig?.focus();
    })
    .catch(() => {});
  await sleep(700); // menu renders

  const hit = await clickFirst(
    page,
    [`ul.dropdown-content a[href*='class_type=${classType}']`],
    sleep,
    1500,
  );
  if (!hit) {
    // Dropdown still didn't yield the link — fall back to a direct navigation
    // so the recording at least lands on the filtered list.
    console.warn(`[record] Filters → ${classType} link missing — navigating directly`);
    await page.goto(`${BASE_URL}/tunes?class_type=${classType}&ws=${WS}`, {
      waitUntil: "domcontentloaded",
    });
  }
  await page.waitForLoadState("domcontentloaded", { timeout: 6000 }).catch(() => {});
  await dismissBanners(page, sleep);
}

const script: RecordScript = async ({ page, sleep }) => {
  // ── Beat 1 — The workspace ───────────────────────────────────────
  // @0 → 10  "This is the America Basics workspace — three product templates:
  //           a shirt, a jacket, a pair of pants."
  await page.goto(`${BASE_URL}/packs?ws=${WS}`, { waitUntil: "domcontentloaded" });
  await dismissBanners(page, sleep);
  await sleep(2600); // settle — ≈ t=3

  await cursorTour(
    page,
    [
      `a.cover-img-wrap[href*='/p/basic-shirt']`,
      `a.cover-img-wrap[href*='/p/basic-jacket-men']`,
      `a.cover-img-wrap[href*='/p/basic-pants2']`,
    ],
    sleep,
    2100,
  );
  await sleep(800); // ≈ t=10

  // ── Beat 2 — References, split by class with the Filters tab ─────
  // @10 → 35  "Open References. Use the Filters button to split it by class —
  //            Human gives you the cast, Garment gives you the wardrobe."
  await page.goto(`${BASE_URL}/tunes?ws=${WS}`, { waitUntil: "domcontentloaded" });
  await dismissBanners(page, sleep);
  await sleep(2200); // settle on the full reference list — ≈ t=12.5

  // Filters → Human. Tour the cast — the America Basics models sit at the top
  // of the filtered grid.
  await openClassFilter(page, "human", sleep);
  await sleep(1800); // filtered list settles — ≈ t=16
  await cursorTour(
    page,
    [
      `turbo-frame#tune_${TUNE_HAZEL}`,
      `turbo-frame#tune_${TUNE_AUTUMN}`,
      `turbo-frame#tune_${TUNE_DAMIEN}`,
    ],
    sleep,
    1700,
  );
  await sleep(400); // ≈ t=22

  // Filters → Garment. Tour the wardrobe — the first cards are jacket / shirt
  // / pants (garment ids are dynamic goods_*, so we tour by DOM order).
  await openClassFilter(page, "garment", sleep);
  await sleep(1800); // ≈ t=27
  await cursorTourNth(page, `a.cover-img-wrap`, [0, 2, 3], sleep, 1700);
  await sleep(600); // ≈ t=35

  // ── Beat 3 — Worked prompts, one per template ────────────────────
  // Each pack page opens in Image mode with its newest prompt pre-loaded; the
  // .meta panel on the right shows the prompt text and the tunes it references.
  // We glide over that panel so the audience reads the faceid tokens.
  //
  // @35 → 60  "Each template already holds a worked prompt — a character
  //            wearing the garments, tied together by reference tokens."
  const tourPrompt = async (packId: string, holdMs: number) => {
    await page.goto(`${BASE_URL}/prompts?pack_id=${packId}&ws=${WS}`, {
      waitUntil: "domcontentloaded",
    });
    await dismissBanners(page, sleep);
    await sleep(1600);
    // Glide over the prompt card, then its text/tunes panel.
    await cursorTour(
      page,
      [`turbo-frame.prompt .meta`, `turbo-frame.prompt`],
      sleep,
      1400,
    );
    await sleep(holdMs);
  };

  await tourPrompt(PACK_SHIRT, 3000); // ≈ t=44
  await tourPrompt(PACK_JACKET, 3000); // ≈ t=53
  await tourPrompt(PACK_PANTS, 3800); // ≈ t=64
};

export default script;
