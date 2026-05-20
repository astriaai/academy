/**
 * One-time login helper for Astria.
 *
 *   npx tsx scripts/auth/login.ts
 *
 * Opens a headed Chromium, navigates to astria.ai, and waits until you've
 * signed in manually. Press Enter in the terminal when you're on a logged-in
 * page and the cookies/localStorage will be saved to storageState.json.
 *
 * That file is gitignored — never commit it.
 */

import { chromium } from "playwright";
import { createInterface } from "node:readline/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const STORAGE = join(ROOT, "storageState.json");

async function main() {
  // Use the system-installed Chrome (channel: "chrome") instead of the
  // Playwright-bundled Chromium so Google SSO doesn't flag the browser as
  // an automation tool. Falls back to bundled Chromium if Chrome isn't found.
  // Hide the automation signals Google checks for during SSO:
  //   - ignoreDefaultArgs --enable-automation  → removes Chrome's "controlled by automated test software" banner
  //                                              and the `--enable-automation` switch that flips navigator.webdriver=true
  //   - --disable-blink-features=AutomationControlled → patches the remaining navigator.webdriver detection
  const stealthOpts = {
    headless: false,
    channel: "chrome" as const,
    ignoreDefaultArgs: ["--enable-automation"],
    args: ["--disable-blink-features=AutomationControlled"],
  };
  let browser;
  try {
    browser = await chromium.launch(stealthOpts);
    console.log("▶ Using system Chrome with automation flags stripped.");
  } catch (e) {
    console.warn(`Chrome channel unavailable (${(e as Error).message.split("\n")[0]}). Falling back to bundled Chromium.`);
    browser = await chromium.launch({
      headless: false,
      ignoreDefaultArgs: ["--enable-automation"],
      args: ["--disable-blink-features=AutomationControlled"],
    });
  }
  const context = await browser.newContext({
    viewport: { width: 1400, height: 900 },
    // Patch navigator.webdriver before any page script runs.
    userAgent: undefined,
  });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  });
  const page = await context.newPage();
  await page.goto("https://www.astria.ai/");

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  console.log("\n▶ A browser window is open. Sign in to Astria.");
  console.log("▶ When you're on a logged-in page (e.g. astria.ai/prompts), come back and press Enter.\n");
  await rl.question("Press Enter to save session → ");
  rl.close();

  await context.storageState({ path: STORAGE });
  console.log(`✓ Saved ${STORAGE}`);

  await context.close();
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
