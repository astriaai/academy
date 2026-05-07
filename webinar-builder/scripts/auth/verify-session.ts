/**
 * Smoke-test storageState.json by loading /prompts in headless Chromium
 * and screenshotting the result.
 *
 *   npx tsx scripts/auth/verify-session.ts
 */
import { chromium } from "playwright";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const STORAGE = join(ROOT, "storageState.json");

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1400, height: 900 },
    storageState: STORAGE,
  });
  const page = await context.newPage();
  await page.goto("https://www.astria.ai/prompts", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);

  const onLogin =
    (await page.locator('input[type="password"]').isVisible().catch(() => false)) ||
    (await page.locator('text=/Welcome back/i').isVisible().catch(() => false));

  await page.screenshot({ path: "/tmp/session-check.png", fullPage: false });

  await context.close();
  await browser.close();

  console.log(onLogin ? "❌ Session NOT valid — /prompts shows login." : "✓ Session valid — /prompts loaded signed in.");
  console.log("Screenshot: /tmp/session-check.png");
  if (onLogin) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
