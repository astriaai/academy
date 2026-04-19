/**
 * Run Gemini's structured inspection across every interesting window of the
 * original webinar — in parallel (3 concurrent calls by default).
 *
 *   tsx pipeline/inspect-webinar-all.ts
 *   tsx pipeline/inspect-webinar-all.ts --concurrency 4
 *
 * Output:
 *   .cache/gemini/chunk-<start>-<end>.json    one per chunk
 *   reports/webinar-inspection.md             combined markdown table-of-contents
 *
 * The chunks below cover the demo portion of the webinar at 4-minute
 * granularity. Edit the list to add/shrink windows as needed.
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inspectWebinarSegment } from "./gemini-inspect.js";
import "dotenv/config";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

interface Chunk { start: string; end: string; note?: string }

const CHUNKS: Chunk[] = [
  // Intro/opening (slides only, useful for cross-checking)
  { start: "00:10:22", end: "00:14:00", note: "opening + what is AI photoshoot" },
  { start: "00:14:00", end: "00:18:00", note: "brand types + identity" },
  { start: "00:18:00", end: "00:22:00", note: "brand DNA examples" },
  { start: "00:22:00", end: "00:26:00", note: "AI is already here (Saks, Nine West, H&M)" },
  { start: "00:26:00", end: "00:30:00", note: "templates + workspaces concept" },
  { start: "00:30:00", end: "00:34:40", note: "end of slides, into login wait" },

  // Demo portion — 4-min windows
  { start: "00:36:00", end: "00:40:00", note: "first UI reveal after login/siren" },
  { start: "00:40:00", end: "00:44:00", note: "first interactions (audio issues here)" },
  { start: "00:44:00", end: "00:48:00", note: "early features" },
  { start: "00:48:00", end: "00:52:00", note: "image generation" },
  { start: "00:52:00", end: "00:56:00", note: "product shots / describe" },
  { start: "00:56:00", end: "01:00:00", note: "packs / templates" },
  { start: "01:00:00", end: "01:04:00", note: "Lookbook begin" },
  { start: "01:04:00", end: "01:08:00", note: "Lookbook continued" },
  { start: "01:08:00", end: "01:12:00", note: "context menu + reference editing (seg 04)" },
  { start: "01:12:00", end: "01:16:00", note: "deeper editing" },
  { start: "01:16:00", end: "01:20:00", note: "more editing / describe" },
  { start: "01:20:00", end: "01:24:00", note: "templates section" },
  { start: "01:24:00", end: "01:28:00", note: "pack creation" },
  { start: "01:28:00", end: "01:32:00", note: "video mode / advanced" },
  { start: "01:32:00", end: "01:36:52", note: "closing remarks" },
];

interface InspectResult {
  chunk: Chunk;
  ok: boolean;
  json?: Record<string, unknown>;
  error?: string;
}

function sanitize(ts: string) { return ts.replace(/:/g, ""); }

function tryUnwrapRaw(json: Record<string, unknown>): Record<string, unknown> {
  // If the cached file is just `{ "_raw": "..." }`, try to parse the inner
  // string as JSON (Gemini sometimes wraps output in extra quotes or includes
  // a trailing comment that breaks strict JSON).
  if (typeof json._raw !== "string") return json;
  const raw = json._raw.trim();
  try { return JSON.parse(raw) as Record<string, unknown>; } catch { /* try repair */ }
  // Strip common trailing junk and extract the JSON object substring.
  const first = raw.indexOf("{");
  const last = raw.lastIndexOf("}");
  if (first >= 0 && last > first) {
    try { return JSON.parse(raw.slice(first, last + 1)) as Record<string, unknown>; } catch {}
  }
  return json;
}

async function runChunk(c: Chunk): Promise<InspectResult> {
  const id = `chunk-${sanitize(c.start)}-${sanitize(c.end)}`;
  const cacheFile = join(ROOT, ".cache", "gemini", `${id}.json`);
  if (existsSync(cacheFile)) {
    try {
      const json = tryUnwrapRaw(JSON.parse(readFileSync(cacheFile, "utf-8")) as Record<string, unknown>);
      console.log(`[cache] ${c.start}→${c.end} (${c.note ?? ""})`);
      return { chunk: c, ok: true, json };
    } catch { /* fall through to re-run */ }
  }
  try {
    console.log(`[inspect] ${c.start}→${c.end} (${c.note ?? ""})`);
    const json = (await inspectWebinarSegment({
      startTs: c.start,
      endTs: c.end,
      segmentId: id,
      extraPrompt: c.note ? `Context hint: ${c.note}` : undefined,
    })) as Record<string, unknown>;
    return { chunk: c, ok: true, json };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error(`[inspect] ${c.start}→${c.end} FAILED: ${error.slice(0, 160)}`);
    return { chunk: c, ok: false, error };
  }
}

async function parallelMap<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

function fmtInteraction(i: Record<string, unknown>): string {
  const t = i.t ?? "";
  const action = i.action ?? "?";
  const target = i.target_text || i.target_description || "";
  const outcome = i.outcome ?? "";
  return `  - \`${t}\` **${action}** · ${target}${outcome ? `  →  ${outcome}` : ""}`;
}

function renderReport(results: InspectResult[]): string {
  const header = `# Astria webinar — Gemini inspection\n\n` +
    `Source: \`../astria-webinar.mp4\`\n\n` +
    `Run: \`npm run inspect-webinar-all\` · regenerates per-chunk JSON in \`.cache/gemini/\`.\n\n` +
    `## Table of contents\n\n` +
    results.map((r) => {
      const status = r.ok ? "" : " ⚠ FAILED";
      return `- [${r.chunk.start} → ${r.chunk.end}](#${r.chunk.start.replace(/:/g, "")})` +
        `${r.chunk.note ? ` — ${r.chunk.note}` : ""}${status}`;
    }).join("\n") + "\n\n---\n\n";

  const sections = results.map((r) => {
    const id = r.chunk.start.replace(/:/g, "");
    const head = `## <a id="${id}"></a>${r.chunk.start} → ${r.chunk.end}` +
      (r.chunk.note ? ` — *${r.chunk.note}*` : "");
    if (!r.ok) {
      return `${head}\n\n> ⚠ Gemini inspection failed: \`${r.error}\`\n`;
    }
    const j = r.json!;
    const urls = Array.isArray(j.urls_visible) ? (j.urls_visible as string[]) : [];
    const interactions = Array.isArray(j.interactions) ? (j.interactions as Array<Record<string, unknown>>) : [];
    const affordances = Array.isArray(j.notable_ui_affordances) ? (j.notable_ui_affordances as string[]) : [];
    const open = Array.isArray(j.open_questions) ? (j.open_questions as string[]) : [];

    return [
      head,
      "",
      `**Summary.** ${j.summary ?? "—"}`,
      "",
      `**URLs visible.** ${urls.length ? urls.map((u) => `\`${u}\``).join(", ") : "—"}`,
      "",
      `**UI state.** ${j.ui_state ?? "—"}`,
      "",
      interactions.length ? `**Interactions (${interactions.length}).**\n${interactions.map(fmtInteraction).join("\n")}` : "**Interactions.** —",
      "",
      affordances.length ? `**Notable affordances.** ${affordances.join(", ")}` : "",
      "",
      open.length ? `**Open questions.**\n${open.map((q) => `- ${q}`).join("\n")}` : "",
      "",
    ].filter((s) => s !== "").join("\n") + "\n";
  });

  return header + sections.join("\n---\n\n");
}

async function main() {
  const concurrency = Number(process.argv[process.argv.indexOf("--concurrency") + 1]) || 3;
  console.log(`Inspecting ${CHUNKS.length} chunks with concurrency=${concurrency}`);

  const results = await parallelMap(CHUNKS, concurrency, runChunk);

  mkdirSync(join(ROOT, "reports"), { recursive: true });
  const reportPath = join(ROOT, "reports", "webinar-inspection.md");
  writeFileSync(reportPath, renderReport(results));

  const ok = results.filter((r) => r.ok).length;
  console.log(`\nDone. ${ok}/${results.length} chunks inspected → ${reportPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
