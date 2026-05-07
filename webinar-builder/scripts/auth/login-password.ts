/**
 * Headless password-based login for Astria. Reads creds from env so the
 * credentials never touch the repo:
 *
 *   ASTRIA_EMAIL=... ASTRIA_PASSWORD=... npx tsx scripts/auth/login-password.ts
 *
 * Writes cookies + localStorage to storageState.json on success. Gitignored.
 */

import { chromium, type Page } from "playwright";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Click every dismiss ("×") button on the Astria top announcement banners
 * and the cookie-consent banner. Each click writes a cookie / localStorage
 * key that persists the "seen" state.
 */
async function dismissAnnouncements(page: Page) {
  // Cookie consent first — it's usually at the bottom.
  const cookieAccept = page.locator('[data-action="cookie-consent#accept"]').first();
  if (await cookieAccept.isVisible({ timeout: 1000 }).catch(() => false)) {
    await cookieAccept.click({ timeout: 1500 }).catch(() => {});
    await page.waitForTimeout(200);
  }

  // Top banners: each link (Cinematic Video, WAN 2.7, Seedance 2) has a
  // sibling "×" close button. Click all of them repeatedly until no more
  // appear — new ones may slide up after the previous disappears.
  for (let pass = 0; pass < 6; pass++) {
    const closes = page
      .locator(
        '[aria-label="Close"], button.btn-circle:has-text("×"), a:has-text("×"), button:has-text("×")'
      );
    const count = await closes.count().catch(() => 0);
    if (!count) break;
    let clicked = 0;
    for (let i = 0; i < count; i++) {
      const btn = closes.nth(i);
      if (!(await btn.isVisible().catch(() => false))) continue;
      await btn.click({ timeout: 600 }).catch(() => {});
      clicked++;
      await page.waitForTimeout(120);
    }
    if (!clicked) break;
    await page.waitForTimeout(250);
  }

  // Belt-and-suspenders: mark every announcement as seen in localStorage,
  // in case the × buttons don't cover a variant.
  await page.evaluate(() => {
    try {
      for (const k of Object.keys(localStorage)) {
        if (/announce|banner|promo|cookie/i.test(k)) {
          localStorage.setItem(k, "dismissed");
        }
      }
      // Common Astria announcement flags we've observed.
      [
        "announce-cinematic-video",
        "announce-wan-2-7",
        "announce-seedance-2",
        "cookie-consent",
        "cookie-consent-dismissed",
      ].forEach((k) => localStorage.setItem(k, "1"));
    } catch {}
  });
  await page.waitForTimeout(200);
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const STORAGE = join(ROOT, "storageState.json");

async function main() {
  const email = process.env.ASTRIA_EMAIL;
  const password = process.env.ASTRIA_PASSWORD;
  if (!email || !password) {
    console.error("ASTRIA_EMAIL and ASTRIA_PASSWORD must be set in the environment.");
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();

  await page.goto("https://www.astria.ai/users/sign_in", { waitUntil: "domcontentloaded" });

  // Astria renders the email/password form hidden behind a "Use Password"
  // toggle. Strip the .hidden class off the inline sign-in form (not the
  // modal copy) and fill it directly.
  await page.evaluate(() => {
    document
      .querySelectorAll<HTMLElement>("form.form-signin")
      .forEach((f) => f.classList.remove("hidden"));
  });

  // Target the sign-in form specifically (the register form also has
  // #user_email — scope it).
  const emailInput = page.locator("form.form-signin #user_email").first();
  await emailInput.waitFor({ state: "visible", timeout: 8_000 });
  await emailInput.fill(email);

  const passwordInput = page.locator("form.form-signin #user_password").first();
  await passwordInput.waitFor({ state: "visible", timeout: 8_000 });
  await passwordInput.fill(password);

  const submit = page
    .locator('form.form-signin input[type="submit"][value*="Log in" i]')
    .first();
  await submit.click({ timeout: 4_000 }).catch(() => {});

  // Wait for navigation away from the login form. We treat landing on the
  // Astria shell (e.g. /prompts, /templates, /pay) as success.
  await page.waitForFunction(
    () => {
      const url = location.pathname;
      const hasEmailField = !!document.querySelector('input[type="email"]');
      return !hasEmailField && (url === "/" || url.startsWith("/prompts") || url.startsWith("/templates") || url.startsWith("/p/") || url.startsWith("/pay"));
    },
    { timeout: 15_000 }
  ).catch(async () => {
    // Fallback: just give the page a few seconds and grab state anyway.
    await page.waitForTimeout(4000);
  });

  // Ensure /prompts loads logged-in before persisting.
  await page.goto("https://www.astria.ai/prompts", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  const stillAtLogin =
    (await page.locator('input[type="email"]').isVisible().catch(() => false)) ||
    (await page.locator('text=/Welcome back/i').isVisible().catch(() => false));

  if (stillAtLogin) {
    console.error("Login appears to have failed — /prompts still shows the login screen.");
    await context.close();
    await browser.close();
    process.exit(2);
  }

  // Dismiss the blue announcement banners at the top (Cinematic Video, WAN,
  // Seedance, cookie consent). Each "×" click persists the dismissal via
  // localStorage/cookies which we then capture in storageState.
  await dismissAnnouncements(page);

  await context.storageState({ path: STORAGE });
  console.log(`✓ Saved ${STORAGE}`);
  console.log(`✓ Logged in as ${email}`);

  await context.close();
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
