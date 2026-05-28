/**
 * Deterministic face-inpainting workflow recording.
 *
 * The live prompts workspace is too volatile for a published course segment:
 * the selected workspace can show unrelated generations, auth banners, or an
 * empty state. This recorder drives the committed mock page instead, using the
 * real face-inpainting assets and the same Astria UI affordances the narration
 * calls out: reference chips, model picker, Inpaint faces, send, and 1/2 result
 * comparison.
 */
import type { Page } from "playwright";
import type { RecordScript, Viewport } from "../../../pipeline/record-screencast.js";

export const viewport: Viewport = { width: 1600, height: 900 };

const MOCK_URL = new URL("../../../assets/mocks/face-inpainting/prompt-box.html", import.meta.url).href;

async function moveTo(page: Page, selector: string, steps = 18) {
  const box = await page.locator(selector).first().boundingBox({ timeout: 3000 });
  if (!box) throw new Error(`record target not visible: ${selector}`);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps });
}

async function clickTarget(page: Page, selector: string) {
  await moveTo(page, selector, 18);
  await page.mouse.down();
  await page.waitForTimeout(90);
  await page.mouse.up();
}

const script: RecordScript = async ({ page, sleep }) => {
  await page.goto(MOCK_URL, { waitUntil: "load" });

  // The outer screencast-pip layout already draws a browser chrome, so hide
  // the mock's standalone chrome before recording it into that frame.
  await page.addStyleTag({
    content: `
      .chrome { display: none !important; }
      .nav { padding-top: 18px; }
    `,
  });

  await page.waitForFunction(() => typeof (window as any).__typePrompt === "function");

  // 0-6s: land on the prompts UI.
  await page.mouse.move(1220, 260, { steps: 12 });
  await sleep(1800);
  await moveTo(page, ".promptbox", 18);
  await sleep(1200);

  // 6-18s: write the prompt and show the pinned reference chips.
  await moveTo(page, "#prompt-text", 18);
  await page.evaluate(() => (window as any).__typePrompt());
  await sleep(8000);
  await moveTo(page, "#chip-woman", 16);
  await sleep(1400);

  // 18-26s: point out the model picker.
  await moveTo(page, "#model-pill", 18);
  await sleep(6200);

  // 26-36s: toggle Inpaint faces on.
  await clickTarget(page, "#toggle-inpaint");
  await page.evaluate(() => (window as any).__toggleInpaint());
  await sleep(8200);

  // 36-44s: send the prompt and let the result appear.
  await clickTarget(page, "#send-btn");
  await page.evaluate(() => (window as any).__sendPrompt());
  await sleep(2800);
  await page.evaluate(() => (window as any).__showResult());
  await sleep(3500);

  // 44s onward: compare 1 Final vs 2 Inpaint Woman Original, then return to 1.
  await clickTarget(page, "#opt-original");
  await page.evaluate(() => (window as any).__switchVersion("original"));
  await sleep(3200);
  await clickTarget(page, "#opt-final");
  await page.evaluate(() => (window as any).__switchVersion("final"));
  await sleep(3800);
};

export default script;
