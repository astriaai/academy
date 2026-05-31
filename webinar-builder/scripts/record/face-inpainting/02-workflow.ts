/**
 * Real Astria UI recording for the face-inpainting workflow.
 *
 * Flow:
 *   1. Use the real prompt box, prefilled from a saved lookbook result.
 *   2. Set the Nano Banana output resolution to 4K.
 *   3. Open the real cog menu and enable `prompt[inpaint_faces]`.
 *   4. Hover Generate, then jump to an existing completed prompt to avoid
 *      creating a new generation during recording.
 *   5. Open the real lightbox, compare at 100/300/600%, and switch between Final
 *      and Original.
 */
import type { Page } from "playwright";
import type { RecordScript, Viewport } from "../../../pipeline/record-screencast.js";

export const viewport: Viewport = { width: 1600, height: 900 };
export const trimStartSeconds = 1.25;

const BASE_URL = process.env.ASTRIA_UI_URL ?? "https://www.astria.ai";
const WORKSPACE_ID = 553;
const MODEL_TUNE_ID = 4180298;
const DEMO_PROMPT_ID = Number(process.env.FACE_INPAINTING_DEMO_PROMPT_ID ?? "43213326");
const ORIGINAL_LAYER_LABEL = "Inpaint Woman Original" as const;
const DEMO_PROMPT_URL = `${BASE_URL}/tunes/${MODEL_TUNE_ID}/prompts/${DEMO_PROMPT_ID}?ws=${WORKSPACE_ID}`;
const PROMPTS_URL = `${BASE_URL}/prompts?ws=${WORKSPACE_ID}&inpaint_faces=true`;
const DEMO_PROMPT_TEXT =
  "<faceid:4094449:1.0> pose. " +
  "<faceid:4868850:1.0> woman. Clean fashion lookbook realistic, full 1.80 high female model, " +
  "long legs, hip tilted, relaxed confident stance, centered. " +
  "<faceid:4869007:1.0> maxi dress. Plain background #ffffff.";

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

async function composerText(page: Page) {
  return page.locator(".tribute-prompt-input").first().innerText({ timeout: 2000 }).catch(() => "");
}

async function fillComposerFallback(page: Page, sleep: (ms: number) => Promise<void>) {
  const target = page.locator(".tribute-prompt-input").first();
  const box = await target.boundingBox({ timeout: 2500 }).catch(() => null);
  if (!box) return false;
  await glide(page, box.x + Math.min(300, box.width / 2), box.y + Math.min(70, box.height / 2), 22);
  await target.click({ timeout: 1000 }).catch(() => {});
  await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A").catch(() => {});
  await page.keyboard.type(DEMO_PROMPT_TEXT, { delay: 4 });
  await sleep(300);
  return true;
}

async function ensureDemoDraft(page: Page, sleep: (ms: number) => Promise<void>) {
  let composer = await composerText(page);
  if (/4868850[\s\S]+maxi dress/i.test(composer)) return;

  await page.goto(DEMO_PROMPT_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await sleep(900);
  await clickFirst(
    page,
    [
      "[data-action*='prompt#reuse']",
      "a.btn-copy:has-text('Rerun')",
      "a:has-text('Rerun')",
      "text=Rerun",
    ],
    sleep,
    2000,
  );
  await sleep(900);

  composer = await composerText(page);
  if (!/4868850[\s\S]+maxi dress/i.test(composer)) {
    await page.goto(PROMPTS_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await sleep(700);
    await fillComposerFallback(page, sleep);
  }
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
  await sleep(250);
}

async function zoomPromptBox(page: Page) {
  await page.evaluate(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "instant" as ScrollBehavior });
    document.body.style.zoom = "1.25";
  });
}

async function setResolution4K(page: Page, sleep: (ms: number) => Promise<void>) {
  const box = await page
    .evaluate(() => {
      const select =
        document.querySelector<HTMLSelectElement>('select[name="prompt[resolution]"]') ||
        Array.from(document.querySelectorAll<HTMLSelectElement>("select")).find((el) =>
          /resolution/i.test(el.name || el.id || el.closest("label")?.textContent || ""),
        );
      if (!select) return null;
      const r = select.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    })
    .catch(() => null);

  if (box) {
    await glide(page, box.x + box.width / 2, box.y + box.height / 2, 20);
    await sleep(300);
  }

  await page
    .evaluate(() => {
      const selects = Array.from(document.querySelectorAll<HTMLSelectElement>("select"));
      for (const select of selects) {
        const has4k = Array.from(select.options).some((option) => option.value === "4K" || option.textContent?.includes("4K"));
        const looksLikeResolution = /resolution/i.test(select.name || select.id || select.closest("label")?.textContent || "");
        if (!has4k || !looksLikeResolution) continue;
        select.value = "4K";
        select.dispatchEvent(new Event("input", { bubbles: true }));
        select.dispatchEvent(new Event("change", { bubbles: true }));
        const tomSelect = (select as HTMLSelectElement & { tomselect?: { setValue: (value: string) => void } }).tomselect;
        tomSelect?.setValue("4K");
      }
    })
    .catch(() => {});
  await sleep(650);
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
      const composer = document.querySelector<HTMLElement>(".tribute-prompt-input");
      const composerRect = composer?.getBoundingClientRect();
      const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>("button"));
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
          if (!isGear) return false;
          if (!composerRect) return true;
          const centerY = b.y + b.height / 2;
          return centerY > composerRect.top - 80 && centerY < composerRect.bottom + 140;
        });
      const match = composerRect
        ? candidates.sort((a, b) => {
            const ar = Math.abs(a.x - composerRect.right) + Math.abs(a.y - composerRect.bottom);
            const br = Math.abs(b.x - composerRect.right) + Math.abs(b.y - composerRect.bottom);
            return ar - br;
          })[0]
        : candidates[0];
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

  await sleep(700);
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
  await sleep(700);
  await page.keyboard.press("Escape").catch(() => {});
  await page.mouse.click(760, 170).catch(() => {});
  await sleep(500);
}

async function openCompletedLightbox(page: Page, sleep: (ms: number) => Promise<void>) {
  await page.goto(DEMO_PROMPT_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await sleep(900);
  await clickFirst(page, ["a.prompt-image", ".prompt-image"], sleep, 2500);
  await page.locator(".lightbox-overlay.active").first().waitFor({ state: "visible", timeout: 5000 });
  await sleep(900);
}

async function showZoomBadge(page: Page, label: string) {
  await page
    .evaluate((text) => {
      let badge = document.querySelector<HTMLDivElement>("#codex-zoom-badge");
      if (!badge) {
        const style = document.createElement("style");
        style.textContent = `
          #codex-zoom-badge {
            position: fixed;
            left: 72px;
            bottom: 62px;
            z-index: 2147483647;
            display: flex;
            align-items: baseline;
            gap: 12px;
            padding: 12px 18px;
            background: rgba(11,11,12,0.78);
            border: 1px solid rgba(217,185,122,0.55);
            box-shadow: 0 18px 44px rgba(0,0,0,0.36);
            color: #f4f1ec;
            font-family: Inter, ui-sans-serif, system-ui, sans-serif;
            pointer-events: none;
          }
          #codex-zoom-badge b {
            color: #d9b97a;
            font-size: 34px;
            line-height: 1;
            font-weight: 650;
          }
          #codex-zoom-badge span {
            color: #a8a39a;
            font-size: 12px;
            letter-spacing: 0.22em;
            text-transform: uppercase;
          }
        `;
        document.head.appendChild(style);
        badge = document.createElement("div");
        badge.id = "codex-zoom-badge";
        badge.innerHTML = "<b></b><span></span>";
        document.body.appendChild(badge);
      }
      const value = badge.querySelector("b");
      if (value) value.textContent = text;
      const detail = badge.querySelector("span");
      if (detail) detail.textContent = "Original vs Final";
    }, label)
    .catch(() => {});
}

async function dragLightboxToFace(
  page: Page,
  sleep: (ms: number) => Promise<void>,
  label: "100%" | "300%" | "600%",
) {
  const pulls = {
    "100%": [],
    "300%": [{ from: [640, 420], to: [628, 675], steps: 24 }],
    "600%": [{ from: [650, 420], to: [660, 610], steps: 22 }],
  }[label];

  if (!pulls.length) return;

  await page.mouse.move(pulls[0].from[0], pulls[0].from[1], { steps: 12 });
  await sleep(90);
  for (const pull of pulls) {
    await page.mouse.down();
    await sleep(50);
    await page.mouse.move(pull.to[0], pull.to[1], { steps: pull.steps });
    await sleep(50);
    await page.mouse.up();
    await sleep(250);
  }
}

async function zoomLightboxStep(
  page: Page,
  sleep: (ms: number) => Promise<void>,
  label: "100%" | "300%" | "600%",
  wheelTicks: number,
) {
  const anchors = {
    "100%": [760, 430],
    "300%": [635, 160],
    "600%": [770, 470],
  } satisfies Record<typeof label, number[]>;
  const [anchorX, anchorY] = anchors[label];
  await glide(page, anchorX, anchorY, 20);
  await sleep(140);

  // Anchor the wheel over the face, then visibly hold-and-drag the image so
  // the face lands in the inspection area before we compare Original and Final.
  for (let i = 0; i < wheelTicks; i += 1) {
    await page.mouse.wheel(0, -900);
    await sleep(35);
  }
  await showZoomBadge(page, label);
  await dragLightboxToFace(page, sleep, label);
  await sleep(300);
}

async function switchLightboxLayer(
  page: Page,
  sleep: (ms: number) => Promise<void>,
  label: "Final" | typeof ORIGINAL_LAYER_LABEL,
  holdMs: number,
) {
  const selectors =
    label === ORIGINAL_LAYER_LABEL
      ? [
          `button.lightbox-layer-btn:has-text("${label}")`,
          'button.lightbox-layer-btn:has-text("Original")',
          'button.lightbox-layer-btn:has-text("Raw")',
        ]
      : [`button.lightbox-layer-btn:has-text("${label}")`];
  await clickFirst(page, selectors, sleep, 1500);
  await sleep(holdMs);
}

const script: RecordScript = async ({ page, sleep }) => {
  await page.goto(PROMPTS_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await sleep(900);

  await ensureDemoDraft(page, sleep);
  await resetInpaintFaces(page, sleep);

  // Zoom in on the actual prompt composer: real reference chips and prompt text.
  await zoomPromptBox(page);
  await sleep(500);
  await moveTo(page, ".tribute-prompt-input", 18);
  await sleep(1300);
  await setResolution4K(page, sleep);

  // Enable Inpaint faces from the real cog wheel so the second Nano Banana pass
  // is visible as a workflow choice, not an abstract checkbox in narration.
  await enableInpaintFromCog(page, sleep);
  await sleep(650);

  await resetPromptBoxZoom(page);
  await sleep(350);
  await page.keyboard.press("Escape").catch(() => {});
  await page.mouse.click(760, 170).catch(() => {});
  await sleep(250);
  await moveTo(page, "[data-testid='create-prompt-button']", 18).catch(() => {});
  await sleep(900);

  await openCompletedLightbox(page, sleep);

  // Real lightbox zoom with Original/Final switching at practical inspection sizes.
  await zoomLightboxStep(page, sleep, "100%", 0);
  await switchLightboxLayer(page, sleep, ORIGINAL_LAYER_LABEL, 600);
  await switchLightboxLayer(page, sleep, "Final", 650);

  await zoomLightboxStep(page, sleep, "300%", 7);
  await switchLightboxLayer(page, sleep, ORIGINAL_LAYER_LABEL, 650);
  await switchLightboxLayer(page, sleep, "Final", 650);

  await zoomLightboxStep(page, sleep, "600%", 8);
  await switchLightboxLayer(page, sleep, ORIGINAL_LAYER_LABEL, 650);
  await switchLightboxLayer(page, sleep, "Final", 650);
  await switchLightboxLayer(page, sleep, ORIGINAL_LAYER_LABEL, 900);
};

export default script;
