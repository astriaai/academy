/**
 * Recorder helpers — utilities shared by the Playwright recording scripts
 * under `scripts/record/<project>/<id>.ts`. Centralised so per-recorder
 * scripts stay focused on the beat structure rather than the mechanics.
 */
import type { Page } from "playwright";

// ── humanType ────────────────────────────────────────────────────────────

export interface HumanTypeOpts {
  /** Target average words-per-minute (5 chars/word convention). Default 200. */
  wpm?: number;
  /** Per-keystroke jitter as a fraction of the base delay (0..1). Default 0.55. */
  jitter?: number;
  /** Extra ms paused after `, ; :` characters. Default 110. */
  pausePunct?: number;
  /** Extra ms paused after `. ! ?` characters. Default 260. */
  pauseSentence?: number;
  /** Probability of an inter-word "thinking" pause (0..1). Default 0.04. */
  thinkProb?: number;
  /** Min thinking-pause ms. Default 280. */
  thinkMin?: number;
  /** Max thinking-pause ms. Default 620. */
  thinkMax?: number;
  /** Override the deterministic seed (default: a hash of `text`). */
  seed?: number;
}

const HUMAN_TYPE_DEFAULTS: Required<HumanTypeOpts> = {
  wpm: 200,
  jitter: 0.55,
  pausePunct: 110,
  pauseSentence: 260,
  thinkProb: 0.04,
  thinkMin: 280,
  thinkMax: 620,
  // Note: seed is replaced per-call by fnv1aHash(text) when not provided.
  seed: 0,
};

/**
 * Type `text` into the currently-focused field the way a person at a
 * keyboard would — jittered per-keystroke delay around a target WPM,
 * longer pauses at commas/colons and after sentences, plus occasional
 * brief mid-phrase "thinking" pauses between words. The randomness is
 * seeded by the text, so re-recording the same input produces the same
 * rhythm (frame-stable captures, deterministic cuts).
 *
 *   await humanType(page, "editorial fashion commercial - boy with skateboard");
 *
 *   // Bursty/faster, for typing slash-commands where pauses look wrong:
 *   await humanType(page, "/artboard", { wpm: 320, jitter: 0.25, thinkProb: 0 });
 *
 *   // Slower, for an "uncertain" beat:
 *   await humanType(page, "make it more moody", { wpm: 140, thinkProb: 0.12 });
 */
export async function humanType(
  page: Page,
  text: string,
  opts: HumanTypeOpts = {},
): Promise<void> {
  const o = { ...HUMAN_TYPE_DEFAULTS, ...opts };
  const seed = opts.seed ?? fnv1aHash(text);
  const rand = mulberry32(seed);
  // wpm × 5 chars/word → chars/min → ms/char
  const baseMs = 60_000 / (o.wpm * 5);

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    await page.keyboard.type(ch);
    // Per-key jitter — symmetric around the base, floored so it never
    // collapses to ~0 (typing that fast reads as glitchy on capture).
    const j = 1 - o.jitter / 2 + rand() * o.jitter;
    let delay = baseMs * Math.max(0.3, j);
    if (",;:".includes(ch)) delay += o.pausePunct;
    if (".!?".includes(ch)) delay += o.pauseSentence;
    if (ch === " " && rand() < o.thinkProb) {
      delay += o.thinkMin + rand() * (o.thinkMax - o.thinkMin);
    }
    await page.waitForTimeout(delay);
  }
}

// ── deterministic PRNG ───────────────────────────────────────────────────
// Mulberry32 + FNV-1a — small, fast, deterministic. Enough for keystroke
// jitter; no statistical claims beyond that.

function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function fnv1aHash(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// ── glide ────────────────────────────────────────────────────────────────
// Eased synthetic-cursor motion. The recorder's overlay cursor uses
// transition:none, so smooth motion has to be baked into many spaced
// substeps. State (cursorX/cursorY) lives at module scope — fine because
// recordings are sequential, not concurrent.

let cursorX = 0;
let cursorY = 0;

/**
 * Glide the synthetic cursor to (x, y) the way a hand moves a mouse:
 * accelerating out of the start, decelerating into the target. Substeps
 * scale with distance — short hops snap, long sweeps stay fluid.
 */
export async function glide(
  page: Page,
  x: number,
  y: number,
): Promise<void> {
  const fromX = cursorX;
  const fromY = cursorY;
  const dist = Math.hypot(x - fromX, y - fromY);
  cursorX = x;
  cursorY = y;
  if (dist < 1.5) {
    await page.mouse.move(x, y);
    return;
  }
  const steps = Math.max(12, Math.min(64, Math.round(dist / 9)));
  const durationMs = Math.max(220, Math.min(760, dist * 0.7));
  const perStepMs = durationMs / steps;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    await page.mouse.move(fromX + (x - fromX) * e, fromY + (y - fromY) * e);
    await page.waitForTimeout(perStepMs);
  }
}

// ── chat helpers ─────────────────────────────────────────────────────────
// A small toolkit for recording chat-widget interactions properly: send a
// message, wait until the server-side reply finishes, click an answer chip
// when the agent asks a question. Each piece is generic — the only Astria-
// specific bit is the default `chatRoot` selector ("#chat-widget"), which
// callers can override.

const CHAT_ROOT = "#chat-widget";
const CHAT_COMPOSER = "textarea.aui-composer-input";

export interface ChatSendOpts {
  /** Override the chat-widget root (default `#chat-widget`). */
  chatRoot?: string;
  /** Override the composer textarea selector. */
  composerSelector?: string;
  /** Human-type options passed straight to {@link humanType}. */
  typeOpts?: HumanTypeOpts;
  /** ms to hold on the composed message before pressing Enter (default 800). */
  holdBeforeSendMs?: number;
  /**
   * When the message starts with `/skill <body>`, type the slash-command
   * fast/steady, wait for the chat-widget's skill picker to surface, click
   * it, then type the body at the normal pace. Set to `false` to type the
   * whole string straight (default: auto — enabled when the message
   * matches /^\/\w+\s/).
   */
  pickSlashSkill?: boolean;
  /**
   * Type the message but don't press Enter — composer keeps the draft.
   * Useful for dry-runs that exercise the typing path without invoking
   * the (paid) skill.
   */
  noSubmit?: boolean;
}

/**
 * Type a message into the chat composer and submit. After Enter we wait
 * for the composer to clear (the chat-widget's signal that the message
 * was accepted), with a short cap so we don't hang on edge cases.
 */
export async function chatSend(
  page: Page,
  text: string,
  opts: ChatSendOpts = {},
): Promise<void> {
  const root = opts.chatRoot ?? CHAT_ROOT;
  const composer = opts.composerSelector ?? CHAT_COMPOSER;
  const el = page.locator(composer).first();
  // Land the cursor naturally on the field before typing.
  const box = await el.boundingBox({ timeout: 1500 }).catch(() => null);
  if (box) {
    await glide(page, box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(120);
  }
  await el.click({ timeout: 800 }).catch(() => {});
  await page.keyboard.press("End").catch(() => {});
  await page.waitForTimeout(150);

  // Slash-command handling: when the message starts with `/skill body…`,
  // typing all of it in one go often submits as plain text rather than
  // invoking the skill. The chat-widget instead expects: type the slash
  // command, the skill picker pops, click it, then type the body. Auto-
  // detect that shape unless the caller explicitly opts out.
  const slashMatch = text.match(/^(\/[A-Za-z][\w-]*)\s+(.+)$/s);
  const pickSlashSkill =
    opts.pickSlashSkill ?? Boolean(slashMatch);
  if (pickSlashSkill && slashMatch) {
    const [, slashCmd, body] = slashMatch;
    // Slash command — type fast and steady.
    await humanType(page, slashCmd!, { wpm: 320, jitter: 0.25, thinkProb: 0 });
    await page.waitForTimeout(800);
    // Click the skill picker (best-effort — if it didn't surface, we just
    // continue typing and trust the chat-widget to parse the slash command
    // from the submitted text).
    const pickerSels = [
      `${root} button:has-text("${slashCmd}")`,
      `${root} [role='button']:has-text("${slashCmd}")`,
    ];
    for (const sel of pickerSels) {
      const btn = page.locator(sel).first();
      const visible = await btn.isVisible({ timeout: 600 }).catch(() => false);
      if (visible) {
        const bb = await btn.boundingBox({ timeout: 600 }).catch(() => null);
        if (bb) {
          await glide(page, bb.x + bb.width / 2, bb.y + bb.height / 2);
          await page.waitForTimeout(200);
        }
        await btn.click({ timeout: 1000 }).catch(() => {});
        break;
      }
    }
    await page.waitForTimeout(500);
    // Re-focus the composer (the picker click can blur it), land the
    // caret at the end, then type the body at the configured pace.
    await el.click({ timeout: 800 }).catch(() => {});
    await page.keyboard.press("End").catch(() => {});
    await page.waitForTimeout(180);
    await humanType(page, body!, opts.typeOpts);
  } else {
    await humanType(page, text, opts.typeOpts);
  }

  await page.waitForTimeout(opts.holdBeforeSendMs ?? 800);
  if (opts.noSubmit) {
    console.log("[chat] noSubmit — leaving draft in composer");
    return;
  }
  await page.keyboard.press("Enter").catch(() => {});
  // Composer clears the moment the message is accepted by the chat client.
  await page
    .waitForFunction(
      (sel) =>
        (document.querySelector(sel) as HTMLTextAreaElement | null)?.value ===
        "",
      composer,
      { timeout: 3000 },
    )
    .catch(() => {});
}

export interface ChatWaitOpts {
  chatRoot?: string;
  /** ms of stable chat content required before declaring "done" (default 7000). */
  stabilityMs?: number;
  /** Overall cap before giving up (default 180_000 — 3 min). */
  timeoutMs?: number;
  /** Poll cadence (default 700). */
  pollMs?: number;
  /** Min wait before the first stability check fires (default 1500). */
  minWaitMs?: number;
}

/**
 * Block until the chat agent appears to be finished responding. Detection
 * is by content stability: poll the chat root's innerText, and resolve
 * once it has not changed for `stabilityMs` milliseconds. A response that
 * includes streaming text, a "Generating..." block, polling commands, or
 * an interactive chip will keep the text changing — only when everything
 * settles do we return.
 *
 * Tolerant — if the timeout hits before stability, returns `false` and
 * the caller decides whether to continue. Never throws.
 */
export async function chatWaitForResponse(
  page: Page,
  opts: ChatWaitOpts = {},
): Promise<boolean> {
  const root = opts.chatRoot ?? CHAT_ROOT;
  const stabilityMs = opts.stabilityMs ?? 7000;
  const timeoutMs = opts.timeoutMs ?? 180_000;
  const pollMs = opts.pollMs ?? 700;
  const minWaitMs = opts.minWaitMs ?? 1500;
  // Initial hold so the very first poll doesn't fire before the agent has
  // even started typing (which would look stable for the wrong reason).
  await page.waitForTimeout(minWaitMs);
  let prev = "";
  let prevAt = Date.now();
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const now = await page
      .evaluate(
        (sel) =>
          (document.querySelector(sel) as HTMLElement | null)?.innerText?.trim() ??
          "",
        root,
      )
      .catch(() => "");
    if (now !== prev) {
      prev = now;
      prevAt = Date.now();
    }
    if (Date.now() - prevAt >= stabilityMs) return true;
    await page.waitForTimeout(pollMs);
  }
  console.warn(
    `[chat] response wait timed out after ${timeoutMs}ms (no stability)`,
  );
  return false;
}

export interface ChatClickOpts {
  chatRoot?: string;
  /** ms to wait for the button to appear (default 60_000). */
  timeoutMs?: number;
  /** Extra selectors to try in case the default one misses. */
  extraSelectors?: string[];
}

/**
 * Click the chat-widget button labelled `label` — for answering a
 * question the agent asked ("16:9", "Generate now", "Retry"). Waits up
 * to `timeoutMs` for the button to surface (the agent may be streaming
 * before it offers a chip), then clicks. Tolerant — returns false if
 * the button never appears.
 */
export async function chatClickButton(
  page: Page,
  label: string,
  opts: ChatClickOpts = {},
): Promise<boolean> {
  const root = opts.chatRoot ?? CHAT_ROOT;
  const selectors = [
    `${root} button:has-text("${label}")`,
    `${root} [role='button']:has-text("${label}")`,
    `${root} .btn:has-text("${label}")`,
    ...(opts.extraSelectors ?? []),
  ];
  const deadline = Date.now() + (opts.timeoutMs ?? 60_000);
  while (Date.now() < deadline) {
    for (const sel of selectors) {
      const el = page.locator(sel).first();
      const visible = await el.isVisible({ timeout: 250 }).catch(() => false);
      if (!visible) continue;
      const box = await el.boundingBox({ timeout: 600 }).catch(() => null);
      if (box) {
        await glide(page, box.x + box.width / 2, box.y + box.height / 2);
        await page.waitForTimeout(220);
      }
      await el.click({ timeout: 1500 }).catch(() => {});
      console.log(`[chat] clicked "${label}"`);
      return true;
    }
    await page.waitForTimeout(500);
  }
  console.log(`[chat] no button "${label}" within ${opts.timeoutMs ?? 60_000}ms`);
  return false;
}
