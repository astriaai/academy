/**
 * Astria Artboard walkthrough, part 2: assistant → /artboard → prompts review.
 *
 * This is the paid generation step. It starts from the America Basics prompts
 * page, opens Astria Assistant, starts a fresh chat, sends `/artboard`, answers
 * the aspect-ratio chip, and returns to Prompts to review the generated grid.
 *
 * Run headed:
 *   HEADED=1 npx tsx pipeline/record-screencast.ts --project artboard 02a-artboard-command
 */
import type { RecordScript } from "../../../pipeline/record-screencast.js";
import {
  chatClickButton,
  chatSend,
  chatWaitForResponse,
  glide,
} from "../../../pipeline/recorder-helpers.js";

const BASE_URL = process.env.ASTRIA_UI_URL ?? "https://www.astria.ai";
const WS = "54";

// Plain-language body after the /artboard skill is picked. Keep it free of
// semicolons (Astria truncates prompts there) and extra slashes.
const ARTBOARD_BRIEF =
  "Build a 4x4 storyboard artboard for a 15-second America Basics studio " +
  "fashion film, in 16:9. Put all three models together, the girl, the woman " +
  "and the man, on a clean off-white seamless studio backdrop with soft " +
  "diffused light. Calm and editorial, with the full wardrobe on show across " +
  "sixteen cinematic shots.";

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

const script: RecordScript = async ({ page, sleep }) => {
  await page.goto(`${BASE_URL}/prompts?ws=${WS}`, {
    waitUntil: "domcontentloaded",
  });
  await dismissBanners(page, sleep);
  await sleep(1400);

  await clickFirst(
    page,
    [
      `a.btn.btn-primary[aria-label='AI assistant']`,
      `a[aria-label='AI assistant']`,
    ],
    sleep,
  );
  await sleep(1600);
  await dismissBanners(page, sleep);

  await clickFirst(
    page,
    [`#chat-widget button[aria-label='New chat']`],
    sleep,
    600,
  );
  await sleep(900);

  await chatSend(page, `/artboard ${ARTBOARD_BRIEF}`, {
    typeOpts: { wpm: 210, thinkProb: 0.03 },
  });

  await chatClickButton(page, "16:9", { timeoutMs: 60_000 });
  await chatWaitForResponse(page, {
    stabilityMs: 6000,
    timeoutMs: 240_000,
  });

  await page.goto(`${BASE_URL}/prompts?ws=${WS}`, {
    waitUntil: "domcontentloaded",
  });
  await dismissBanners(page, sleep);
  await sleep(1800);

  const newest = page
    .locator(".prompt")
    .first()
    .locator("img.max-w-full[src*='mp.astria.ai']")
    .first();
  await newest
    .waitFor({ state: "visible", timeout: 180_000 })
    .catch(() => console.warn("[record] artboard image didn't surface in time"));
  await newest.scrollIntoViewIfNeeded({ timeout: 1500 }).catch(() => {});
  await sleep(4500);
};

export default script;
