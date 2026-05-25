/**
 * Astria Artboard walkthrough, part 5: artboard reference → video prompt.
 *
 * Verified live May 25, 2026:
 *   - Video mode keeps a reference-image input at input#prompt_input_image.
 *   - The artboard reference is NOT prompt_video_first_frame.
 *   - Video prompt goes into .video-tribute-prompt-input.
 *   - Seedance2 Fast 720p value is seedance2_fast_720p.
 *
 * This script prepares the form but does not submit by default, so it is safe
 * to re-record. Set SUBMIT_VIDEO=1 only when you intentionally want to spend a
 * real video generation.
 */
import type { RecordScript } from "../../../pipeline/record-screencast.js";
import { resolve } from "node:path";
import { glide, humanType } from "../../../pipeline/recorder-helpers.js";

const BASE_URL = process.env.ASTRIA_UI_URL ?? "https://www.astria.ai";
const WS = "54";

const ARTBOARD_REFERENCE_PATH = resolve(
  process.cwd(),
  "assets/artboard/america-basics/artboard-act1.jpg",
);

const VIDEO_PROMPT =
  "15-second America Basics studio fashion film, 16:9. All three models " +
  "together on a clean off-white seamless studio backdrop with soft diffused " +
  "light. Calm editorial pacing, gentle movement, wide shots, medium shots, " +
  "close-ups, product details, and group shots across the full wardrobe.";

const TARGET_VIDEO_MODEL = "seedance2_fast_720p";

async function clickFirst(
  page: import("playwright").Page,
  candidates: string[],
  sleep: (ms: number) => Promise<void>,
  perTimeoutMs = 800,
): Promise<boolean> {
  for (const sel of candidates) {
    const el = page.locator(sel).first();
    const box = await el.boundingBox({ timeout: perTimeoutMs }).catch(() => null);
    if (!box) continue;
    await glide(page, box.x + box.width / 2, box.y + box.height / 2);
    await sleep(160);
    await el.click({ timeout: 800 }).catch(() => {});
    return true;
  }
  return false;
}

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
            /^[x×✕✖]\s*$/i.test((el.textContent || "").trim()),
          ) ??
          null;
        if (closeBtn) closeBtn.click();
        else if (b.matches("[data-announcement-banner]")) b.remove();
      }
    })
    .catch(() => {});
  await sleep(200);
}

async function cleanPromptForm(
  page: import("playwright").Page,
  sleep: (ms: number) => Promise<void>,
): Promise<void> {
  await page
    .evaluate(() => {
      const editableSelectors = [
        ".tribute-prompt-input",
        ".video-tribute-prompt-input",
        "textarea[name='prompt[text]']",
        "textarea[name='prompt[video_prompt]']",
      ];
      document.querySelectorAll<HTMLElement>(editableSelectors.join(",")).forEach((el) => {
        if (el instanceof HTMLTextAreaElement) el.value = "";
        else el.innerHTML = "";
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      });

      const removeButtons = document.querySelectorAll<HTMLElement>(
        ".reference-chip-remove, [data-action*='remove'], .chip [aria-label*='Remove' i], button[title*='Remove' i]",
      );
      removeButtons.forEach((b) => b.click());

      document.querySelectorAll<HTMLInputElement>("input[type='file']").forEach((el) => {
        el.value = "";
      });
    })
    .catch(() => {});
  await sleep(700);
}

async function focusEditable(
  page: import("playwright").Page,
  selector: string,
  sleep: (ms: number) => Promise<void>,
): Promise<boolean> {
  const el = page.locator(selector).first();
  const box = await el.boundingBox({ timeout: 1200 }).catch(() => null);
  if (!box) return false;
  const tx = box.x + Math.min(box.width - 28, box.width * 0.62);
  const ty = box.y + box.height / 2;
  await glide(page, tx, ty);
  await sleep(150);
  await el.click({
    timeout: 700,
    position: { x: Math.min(box.width - 28, box.width * 0.62), y: box.height / 2 },
  }).catch(() => {});
  await page.keyboard.press("End").catch(() => {});
  return true;
}

async function chooseVideoModel(
  page: import("playwright").Page,
  sleep: (ms: number) => Promise<void>,
): Promise<void> {
  const wrapperBox = await page
    .evaluate(() => {
      const hidden = document.querySelector<HTMLSelectElement>(
        "select[name='prompt[video_model]']",
      );
      if (!hidden) return null;
      const wrapper =
        hidden.closest(".ts-wrapper") ??
        hidden.parentElement?.querySelector(".ts-wrapper, .ts-control") ??
        hidden.nextElementSibling;
      const el = (wrapper as HTMLElement) ?? null;
      if (!el) return null;
      el.scrollIntoView({ block: "center" });
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    })
    .catch(() => null);

  if (wrapperBox) {
    await glide(page, wrapperBox.x + wrapperBox.w / 2, wrapperBox.y + wrapperBox.h / 2);
    await sleep(250);
    await page.mouse.click(wrapperBox.x + wrapperBox.w / 2, wrapperBox.y + wrapperBox.h / 2).catch(() => {});
    await sleep(650);
  }

  await clickFirst(
    page,
    [
      `.ts-dropdown [role='option']:has-text('Seedance2 Fast 720p')`,
      `.ts-dropdown .option:has-text('Seedance2 Fast 720p')`,
      `.option:has-text('Seedance2 Fast 720p')`,
      `text=/Seedance2\\s*Fast\\s*720p/i`,
    ],
    sleep,
    600,
  );

  await page
    .evaluate((value: string) => {
      const hidden = document.querySelector<HTMLSelectElement>(
        "select[name='prompt[video_model]']",
      );
      if (!hidden) return;
      hidden.value = value;
      hidden.dispatchEvent(new Event("change", { bubbles: true }));
      const ts = (hidden as any).tomselect;
      if (ts && typeof ts.setValue === "function") ts.setValue(value, false);
    }, TARGET_VIDEO_MODEL)
    .catch(() => {});
  await sleep(900);
}

async function clickGenerateIfRequested(
  page: import("playwright").Page,
  sleep: (ms: number) => Promise<void>,
): Promise<void> {
  const generateCandidates = [
    `button[type='submit']:has-text('Generate')`,
    `button:has-text('Generate')`,
    `input[type='submit'][value*='Generate' i]`,
    `.btn-primary:has-text('Generate')`,
  ];

  if (process.env.SUBMIT_VIDEO === "1") {
    await clickFirst(page, generateCandidates, sleep, 1200);
    await sleep(5000);
    return;
  }

  // Hover the button for the recording without submitting.
  for (const sel of generateCandidates) {
    const el = page.locator(sel).first();
    const box = await el.boundingBox({ timeout: 700 }).catch(() => null);
    if (!box) continue;
    await glide(page, box.x + box.width / 2, box.y + box.height / 2);
    await sleep(2500);
    return;
  }
  await sleep(2500);
}

const script: RecordScript = async ({ page, sleep }) => {
  await page.goto(`${BASE_URL}/prompts?ws=${WS}`, { waitUntil: "domcontentloaded" });
  await dismissBanners(page, sleep);
  await sleep(1200);

  await clickFirst(
    page,
    [
      `button.mode-switcher-btn:has-text('Video')`,
      `.mode-switcher-btn:has-text('Video')`,
    ],
    sleep,
  );
  await sleep(900);
  await cleanPromptForm(page, sleep);

  await page
    .locator("input#prompt_input_image")
    .setInputFiles(ARTBOARD_REFERENCE_PATH, { timeout: 6000 })
    .catch((e) => {
      console.warn(`[record] setInputFiles failed: ${(e as Error).message}`);
    });

  const referenceInputBox = await page
    .locator("[data-action*='image-input#triggerFile']")
    .first()
    .boundingBox({ timeout: 800 })
    .catch(() => null);
  if (referenceInputBox) {
    await glide(
      page,
      referenceInputBox.x + referenceInputBox.width / 2,
      referenceInputBox.y + referenceInputBox.height / 2,
    );
  }
  await sleep(7000);

  await focusEditable(page, ".video-tribute-prompt-input", sleep);
  await sleep(300);
  await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A").catch(() => {});
  await page.keyboard.press("Backspace").catch(() => {});
  await sleep(200);
  await humanType(page, VIDEO_PROMPT, { wpm: 190, thinkProb: 0.02 });
  await sleep(4500);

  await chooseVideoModel(page, sleep);

  await clickGenerateIfRequested(page, sleep);
};

export default script;
