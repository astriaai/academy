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
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    viewport: { width: 1400, height: 900 },
  });
  const page = await context.newPage();
  await page.goto("https://www.astria.ai/");

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  console.log("\n▶ A Chromium window is open. Sign in to Astria.");
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
