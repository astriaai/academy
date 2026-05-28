/**
 * Real Astria UI recording for the face-inpainting workflow.
 *
 * Flow:
 *   1. Use the real prompt box, prefilled from the completed demo prompt.
 *   2. Open the real cog menu and enable `prompt[inpaint_faces]`.
 *   3. Zoom the browser page so the prompt, reference chips, and enabled
 *      setting are legible.
 *   4. Click Generate, hold briefly on processing, then jump to the completed
 *      premade prompt to trim the wait.
 *   5. Open the real lightbox and switch between Final and Inpaint Woman Original.
 */
import type { Page } from "playwright";
import type { RecordScript, Viewport } from "../../../pipeline/record-screencast.js";

export const viewport: Viewport = { width: 1600, height: 900 };

const BASE_URL = process.env.ASTRIA_UI_URL ?? "https://www.astria.ai";
const WORKSPACE_ID = 6;
const MODEL_TUNE_ID = 4180298;
const DEMO_PROMPT_ID = 43173961;
const DEMO_PROMPT_URL = `${BASE_URL}/tunes/${MODEL_TUNE_ID}/prompts/${DEMO_PROMPT_ID}?ws=${WORKSPACE_ID}`;
const PROMPTS_URL = `${BASE_URL}/prompts?ws=${WORKSPACE_ID}`;

async function glide(page: Page, x: number, y: number, steps = 18) {
  await page.mouse.move(x, y, { steps });
}

async function moveTo(page: Page, selector: string, steps = 18, timeout = 2000) {
  const box = await page.locator(selector).first().boundingBox({ timeout });
  if (!box) return false;
  await glide(page, box.x + box.width / 2, box.y + box.height / 2, steps);
  return true;
}

async function clickFirst(
  page: Page,
  selectors: string[],
  sleep: (ms: number) => Promise<void>,
  timeout = 1200,
) {
  for (const selector of selectors) {
    const target = page.locator(selector).first();
    const box = await target.boundingBox({ timeout }).catch(() => null);
    if (!box) continue;
    await glide(page, box.x + box.width / 2, box.y + box.height / 2, 18);
    await sleep(180);
    await target.click({ timeout: 1000 }).catch(() => {});
    return true;
  }
  return false;
}

async function ensureDemoDraft(page: Page, sleep: (ms: number) => Promise<void>) {
  const composer = await page.locator(".tribute-prompt-input").first()
    .innerText({ timeout: 3000 })
    .catch(() => "");
  if (/Freya[\s\S]+tank top[\s\S]+Jeans[\s\S]+White Nike shoes/i.test(composer)) return;

  await clickFirst(page, ["a.btn-copy:has-text('Rerun')", "text=Rerun"], sleep, 1500);
  await sleep(1200);
}

async function resetInpaintFaces(page: Page, sleep: (ms: number) => Promise<void>) {
  await page
    .evaluate(() => {
      for (const selector of [
        'input[name="prompt[inpaint_faces]"][type="checkbox"]',
        "#prompt_inpaint_faces_menu",
      ]) {
        const input = document.querySelector<HTMLInputElement>(selector);
        if (!input) continue;
        input.checked = false;
        input.dispatchEvent(new Event("change", { bubbles: true }));
      }
    })
    .catch(() => {});
  await sleep(500);
}

async function zoomPromptBox(page: Page) {
  await page.evaluate(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "instant" as ScrollBehavior });
    document.body.style.zoom = "1.25";
  });
}

async function resetPromptBoxZoom(page: Page) {
  await page.evaluate(() => {
    document.body.style.zoom = "";
    window.scrollTo({ top: 0, left: 0, behavior: "instant" as ScrollBehavior });
  });
}

async function getComposerCogBox(page: Page) {
  return page
    .evaluate(() => {
      const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>("button.btn"));
      const candidates = buttons
        .map((button) => {
          const r = button.getBoundingClientRect();
          return {
            button,
            x: r.x,
            y: r.y,
            width: r.width,
            height: r.height,
            text: (button.textContent ?? "").trim(),
            title: button.getAttribute("title") ?? "",
            html: button.innerHTML,
          };
        })
        .filter((b) => {
          const isGear = b.html.includes("M9.594 3.94");
          const isComposerRow = b.y > 180 && b.y < 290 && b.x > 850 && b.x < 1100;
          return isGear && isComposerRow && b.text === "" && b.title === "";
        });
      const match = candidates[0];
      if (!match) return null;
      return { x: match.x, y: match.y, width: match.width, height: match.height };
    })
    .catch(() => null);
}

async function enableInpaintFromCog(page: Page, sleep: (ms: number) => Promise<void>) {
  const cogBox = await getComposerCogBox(page);

  if (!cogBox) {
    throw new Error("Could not find the prompt composer settings cog");
  }

  await glide(page, cogBox.x + cogBox.width / 2, cogBox.y + cogBox.height / 2, 18);
  await sleep(220);
  await page.mouse.click(cogBox.x + cogBox.width / 2, cogBox.y + cogBox.height / 2);

  let opened = await page.locator("#prompt_inpaint_faces_menu")
    .isVisible({ timeout: 700 })
    .catch(() => false);
  if (!opened) {
    await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>("button.btn"));
      const cog = buttons.find((button) => {
        const r = button.getBoundingClientRect();
        return (
          button.innerHTML.includes("M9.594 3.94") &&
          r.y > 180 &&
          r.y < 290 &&
          r.x > 850 &&
          r.x < 1100
        );
      });
      cog?.click();
    });
    opened = await page.locator("#prompt_inpaint_faces_menu")
      .isVisible({ timeout: 900 })
      .catch(() => false);
  }
  if (!opened) throw new Error("Cog menu opened without the Inpaint faces option");

  await sleep(1200);
  await clickFirst(
    page,
    [
      "label.btn-boolean-toggle:has(input#prompt_inpaint_faces_menu)",
      "input#prompt_inpaint_faces_menu",
      "input#prompt_inpaint_faces",
    ],
    sleep,
    1200,
  );
  await page
    .evaluate(() => {
      const inputs = Array.from(
        document.querySelectorAll<HTMLInputElement>(
          'input[name="prompt[inpaint_faces]"][type="checkbox"], #prompt_inpaint_faces_menu',
        ),
      );
      for (const input of inputs) {
        if (!input.checked) {
          input.checked = true;
          input.dispatchEvent(new Event("change", { bubbles: true }));
        }
      }
    })
    .catch(() => {});
  await sleep(1300);
  await page.keyboard.press("Escape").catch(() => {});
  await page.mouse.click(760, 170).catch(() => {});
  await sleep(500);
}

async function openCompletedLightbox(page: Page, sleep: (ms: number) => Promise<void>) {
  await page.goto(DEMO_PROMPT_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await sleep(1700);
  await clickFirst(page, ["a.prompt-image", ".prompt-image"], sleep, 2500);
  await page.locator(".lightbox-overlay.active").first().waitFor({ state: "visible", timeout: 5000 });
  await sleep(2200);
}

const script: RecordScript = async ({ page, sleep }) => {
  await page.goto(PROMPTS_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await sleep(1500);

  await ensureDemoDraft(page, sleep);
  await resetInpaintFaces(page, sleep);

  // Enable Inpaint faces from the real cog wheel before zooming the page.
  await enableInpaintFromCog(page, sleep);
  await sleep(1500);

  // Zoom in on the actual prompt composer: real chips, real model/settings row.
  await zoomPromptBox(page);
  await sleep(900);
  await moveTo(page, ".tribute-prompt-input", 18);
  await sleep(3300);

  await resetPromptBoxZoom(page);
  await sleep(800);
  await page.keyboard.press("Escape").catch(() => {});
  await page.mouse.click(760, 170).catch(() => {});
  await sleep(500);
  await moveTo(page, "[data-testid='create-prompt-button']", 18).catch(() => {});
  await sleep(900);

  // Generate, then trim the wait by jumping to the completed prompt.
  await clickFirst(page, ['[data-testid="create-prompt-button"]', 'button[title*="generate" i]'], sleep, 1800);
  await sleep(5200);

  await openCompletedLightbox(page, sleep);

  // Real lightbox layer picker: 1 Final vs 2 Inpaint Woman Original.
  await clickFirst(page, ["button.lightbox-layer-btn:has-text('Inpaint Woman Original')"], sleep, 1500);
  await sleep(4200);
  await clickFirst(page, ["button.lightbox-layer-btn:has-text('Final')"], sleep, 1500);
  await sleep(5200);
};

export default script;
