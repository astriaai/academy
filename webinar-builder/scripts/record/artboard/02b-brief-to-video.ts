/**
 * 02b — Brief → prompt → artboard. Same-chat iteration.
 *
 * Records the full chat → prompt → artboard loop, twice, in ONE thread:
 *
 *   Iteration 1 (~0-50s) — Initial brief
 *     Open the AI assistant in ws=54 (America Basics). Start a fresh
 *     conversation. Type /artboard, pick the skill, type a SUCCINCT brief
 *     (the cast and the vibe — no "artboard" word). Send. Watch the
 *     assistant stream the expanded sixteen-shot prompt. Navigate to
 *     /prompts to see the new entry's generation progress bar fill; once
 *     the artboard lands, click the tile to open it in the lightbox, hold,
 *     then dismiss with Escape.
 *
 *   Iteration 2 (~50-100s) — Refinement, SAME chat
 *     Without starting a new conversation, focus the composer and type
 *     ONLY the change ("make it more moody and color graded"). Send. The
 *     skill recognises the refinement and writes a second prompt. Back to
 *     /prompts — second progress bar fills, second artboard lands, second
 *     lightbox.
 *
 * NOTE — this recording SENDS two /artboard chat messages, each triggering
 * a real GPT Image 2 generation (~$10 a piece) on the demo account. Set
 * SKIP_SEND=1 to compose without submitting (useful when iterating on the
 * script itself).
 *
 * Auth: replays storageState.json — the demo account, with which ws=54 is
 * shared.
 *
 * Run headed:
 *   HEADED=1 npx tsx pipeline/record-screencast.ts --project artboard 02b-brief-to-video
 */
import type { RecordScript } from "../../../pipeline/record-screencast.js";
import {
  glide,
  humanType,
  chatSend,
  chatClickButton,
  chatWaitForResponse,
} from "../../../pipeline/recorder-helpers.js";

const BASE_URL = process.env.ASTRIA_UI_URL ?? "https://www.astria.ai";
const WS = "54"; // America Basics

// Initial brief — succinct. The slash command at the front is the skill
// trigger; the body is what the user "actually wrote" (and per the brief
// rule, the body itself doesn't repeat the word "artboard").
const BRIEF_INITIAL =
  "/artboard editorial fashion commercial - boy with skateboard, girl playing tennis, streetview of woman";

// Refinement in the SAME thread. A plain follow-up doesn't re-trigger the
// /artboard skill (verified live — the chat agent just text-responds and
// no aspect chip appears), so the recorder re-invokes the skill with the
// "just-the-change" body — same chat, same continuity, fresh generation.
const BRIEF_REFINE =
  "/artboard make the same film more moody and dark, outdoor, with greenery. " +
  "Keep the same characters and keep each character in the same template garments. " +
  "Do not swap outfits between people";

// glide, humanType, chat* helpers are all imported from recorder-helpers.

async function dismissBanners(
  page: import("playwright").Page,
  sleep: (ms: number) => Promise<void>,
): Promise<void> {
  await sleep(400);
  await page
    .evaluate(() => {
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
        if (closeBtn) closeBtn.click();
        else if (b.matches("[data-announcement-banner]")) b.remove();
      }
    })
    .catch(() => {});
  await sleep(200);
}

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

async function focusField(
  page: import("playwright").Page,
  selector: string,
  sleep: (ms: number) => Promise<void>,
): Promise<boolean> {
  const el = page.locator(selector).first();
  const box = await el.boundingBox({ timeout: 1200 }).catch(() => null);
  if (!box) return false;
  await glide(page, box.x + box.width / 2, box.y + box.height / 2);
  await sleep(150);
  await el.click({ timeout: 700 }).catch(() => {});
  return true;
}

/**
 * Scroll the /prompts page to the very top so the freshly-created prompt
 * (which turbo-streams in at position 0) is in the viewport — otherwise
 * the new entry's progress bar + landing image happen above the visible
 * area and the viewer sees nothing.
 */
async function scrollToTop(
  page: import("playwright").Page,
  sleep: (ms: number) => Promise<void>,
  durationMs = 700,
): Promise<void> {
  await page.evaluate(
    (durationMs) =>
      new Promise<void>((resolve) => {
        const start = window.scrollY;
        if (start <= 4) {
          resolve();
          return;
        }
        const t0 = performance.now();
        const tick = setInterval(() => {
          const u = Math.min(1, (performance.now() - t0) / durationMs);
          const e = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
          window.scrollTo(0, start * (1 - e));
          if (u >= 1) {
            clearInterval(tick);
            resolve();
          }
        }, 16);
      }),
    durationMs,
  );
  await sleep(200);
}

/**
 * Wait for the topmost prompt's BIG result image (the 4x4 artboard grid)
 * to actually render — its `src` becomes an `mp.astria.ai` URL only once
 * GPT Image 2 finishes. Then glide to it, click, hold on the lightbox,
 * dismiss with Escape. Tolerant — if no real image surfaces, no lightbox.
 */
async function openArtboardLightbox(
  page: import("playwright").Page,
  sleep: (ms: number) => Promise<void>,
  imageTimeoutMs = 120_000,
): Promise<void> {
  const tile = page
    .locator(".prompt")
    .first()
    .locator("img.max-w-full[src*='mp.astria.ai']")
    .first();
  try {
    await tile.waitFor({ state: "visible", timeout: imageTimeoutMs });
  } catch {
    console.log(
      `[record] new artboard image didn't surface within ${imageTimeoutMs}ms — skipping lightbox`,
    );
    return;
  }
  // Make sure the image is in the viewport before we glide to it.
  await tile.scrollIntoViewIfNeeded({ timeout: 1500 }).catch(() => {});
  await sleep(500);
  const box = await tile.boundingBox({ timeout: 1500 }).catch(() => null);
  if (!box) return;
  await glide(page, box.x + box.width / 2, box.y + box.height / 2);
  await sleep(280);
  await tile.click({ timeout: 1000 }).catch(() => {});
  await sleep(900);
  const lightboxSel =
    "[role='dialog'][aria-modal='true'], .modal-open, .modal[open], .lightbox, .image-lightbox, dialog[open]";
  const visible = await page
    .locator(lightboxSel)
    .first()
    .isVisible({ timeout: 500 })
    .catch(() => false);
  if (visible) {
    await sleep(6000); // dwell on the lightboxed artboard
    await page.keyboard.press("Escape").catch(() => {});
    await sleep(700);
  } else {
    await sleep(2200);
  }
}

const script: RecordScript = async ({ page, sleep }) => {
  // ── Setup ────────────────────────────────────────────────────────────
  // Start on /prompts so the viewer sees the prompts list — the new entry
  // appears there as soon as the /artboard skill creates it, via Astria's
  // turbo-stream. No need to navigate again after sending; we stay on this
  // page the whole recording.
  await page.goto(`${BASE_URL}/prompts?ws=${WS}`, {
    waitUntil: "domcontentloaded",
  });
  await dismissBanners(page, sleep);
  await sleep(1200);

  // Open the AI assistant panel (persistent right-side sidebar).
  await clickFirst(
    page,
    [
      `a.btn.btn-primary[aria-label='AI assistant']`,
      `a[aria-label='AI assistant']`,
    ],
    sleep,
  );
  await sleep(1500);
  await dismissBanners(page, sleep);

  // Fresh thread for the first iteration. Subsequent iterations stay in
  // this same thread (no second "New chat" click).
  await clickFirst(
    page,
    [`#chat-widget button[aria-label='New chat']`],
    sleep,
    600,
  );
  await sleep(1000);

  const skipSend = !!process.env.SKIP_SEND;

  // ── Iteration 1 — initial brief ──────────────────────────────────────
  // chatSend auto-detects the slash command, clicks the skill picker, and
  // submits. chatClickButton answers the agent's aspect question.
  // chatWaitForResponse blocks until the assistant + the GPT Image 2
  // generation settle — that wait is the critical bit. Sending iter 2
  // before iter 1 is settled was the cause of the earlier "Something
  // went wrong" errors.
  await chatSend(page, BRIEF_INITIAL, { noSubmit: skipSend });
  if (!skipSend) {
    // First reply: the aspect-ratio chips. Click 16:9.
    await chatClickButton(page, "16:9", { timeoutMs: 60_000 });
    // After the aspect click the chat continues streaming, the prompt is
    // written, and the actual GPT Image 2 generation fires. Pin the page
    // to the top of /prompts so the new prompt entry's progress bar lands
    // in view as it streams in.
    await scrollToTop(page, sleep);
    // openArtboardLightbox now waits for the new artboard's image to
    // actually load (the topmost .prompt's mp.astria.ai-hosted result),
    // so chatWaitForResponse no longer has to time the generation.
  }

  // Open the new artboard's lightbox once the image lands; hold; Escape.
  await openArtboardLightbox(page, sleep);

  // ── Iteration 2 — refinement in the SAME chat ────────────────────────
  // No "New chat" click. Same thread, just the change as the next message.
  // The /artboard prefix re-invokes the skill (plain follow-ups don't
  // trigger it — verified live).
  await chatSend(page, BRIEF_REFINE, {
    typeOpts: { wpm: 170, thinkProb: 0.08 },
    noSubmit: skipSend,
  });
  if (!skipSend) {
    // Aspect chip may or may not surface (the agent reuses prior context),
    // so this is best-effort. If it doesn't appear the agent likely
    // skipped the question.
    await chatClickButton(page, "16:9", { timeoutMs: 60_000 });
    await scrollToTop(page, sleep);
  }

  await openArtboardLightbox(page, sleep);

  // Final small linger so the stitched draft doesn't cut hard.
  await sleep(1500);
};

export default script;
