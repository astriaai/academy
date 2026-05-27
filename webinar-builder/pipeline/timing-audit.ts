/**
 * Timing audit for webinar-builder projects.
 *
 * Checks the common causes of narration drift:
 * - rendered segment shorter than TTS/avatar media plus the stitch tail pad
 * - explicit YAML duration that would trim fresh TTS
 * - timed bullets, pages, markers, SFX, and review beats that run past end
 *
 * Usage:
 *   tsx pipeline/timing-audit.ts --project artboard-2
 *   tsx pipeline/timing-audit.ts --project artboard-2 --strict
 *   tsx pipeline/timing-audit.ts --project artboard-2 --json
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const TAIL_PAD_SEC = Number(process.env.TIMING_TAIL_PAD_SEC ?? "0.75");
const RENDER_TOLERANCE_SEC = Number(process.env.TIMING_RENDER_TOLERANCE_SEC ?? "0.35");

type ProjectYaml = { segments: string[] };
type SegmentYaml = {
  id: string;
  narration?: string;
  visual?: string;
  duration?: number;
  slide?: {
    bullet_starts?: number[];
    columns?: Array<{ bullet_starts?: number[] }>;
  };
  screencast?: {
    pages?: Array<{ start: number; duration: number }>;
  };
  caption?: { hide_at?: number };
  sfx?: Array<{ start: number; duration?: number }>;
  markers?: Array<{ start: number; duration: number }>;
  review?: {
    videos?: Array<{ start: number; duration: number }>;
    artboards?: Array<{ start: number; duration: number }>;
    tile_beats?: Array<{ start: number; duration: number }>;
  };
};

type IssueLevel = "error" | "warn";
type Issue = { level: IssueLevel; segment: string; message: string };
type SegmentReport = {
  id: string;
  yamlDuration: number | null;
  expectedDuration: number | null;
  audioDuration: number | null;
  avatarDuration: number | null;
  renderedDuration: number | null;
  issues: Issue[];
};

function argValue(name: string, fallback?: string): string | undefined {
  const idx = process.argv.indexOf(name);
  return idx === -1 ? fallback : process.argv[idx + 1];
}

function projectName() {
  return argValue("--project", "webinar")!;
}

function ffprobeDuration(file: string): number | null {
  if (!existsSync(file)) return null;
  const r = spawnSync(
    "ffprobe",
    ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file],
    { encoding: "utf-8" },
  );
  if (r.status !== 0) return null;
  const n = Number(r.stdout.trim());
  return Number.isFinite(n) ? n : null;
}

function loadYaml<T>(path: string): T {
  return yaml.load(readFileSync(path, "utf-8")) as T;
}

function roundedDuration(sec: number): number {
  return Math.ceil(sec * 10) / 10;
}

function endOf(start: number, duration = 0): number {
  return start + duration;
}

function collectTimedEnds(segment: SegmentYaml): Array<{ label: string; end: number }> {
  const ends: Array<{ label: string; end: number }> = [];
  segment.sfx?.forEach((s, i) => ends.push({ label: `sfx[${i}]`, end: endOf(s.start, s.duration ?? 2) }));
  segment.markers?.forEach((m, i) => ends.push({ label: `markers[${i}]`, end: endOf(m.start, m.duration) }));
  segment.screencast?.pages?.forEach((p, i) => ends.push({ label: `screencast.pages[${i}]`, end: endOf(p.start, p.duration) }));
  segment.review?.videos?.forEach((v, i) => ends.push({ label: `review.videos[${i}]`, end: endOf(v.start, v.duration) }));
  segment.review?.artboards?.forEach((a, i) => ends.push({ label: `review.artboards[${i}]`, end: endOf(a.start, a.duration) }));
  segment.review?.tile_beats?.forEach((b, i) => ends.push({ label: `review.tile_beats[${i}]`, end: endOf(b.start, b.duration) }));
  segment.slide?.bullet_starts?.forEach((start, i) => ends.push({ label: `slide.bullet_starts[${i}]`, end: start }));
  segment.slide?.columns?.forEach((col, ci) => {
    col.bullet_starts?.forEach((start, bi) => ends.push({ label: `slide.columns[${ci}].bullet_starts[${bi}]`, end: start }));
  });
  if (typeof segment.caption?.hide_at === "number") {
    ends.push({ label: "caption.hide_at", end: segment.caption.hide_at });
  }
  return ends;
}

function auditSegment(project: string, id: string): SegmentReport {
  const segmentPath = join(ROOT, "script", "segments", project, `${id}.yaml`);
  const segment = loadYaml<SegmentYaml>(segmentPath);
  const audio = ffprobeDuration(join(ROOT, "assets", "audio", project, `${id}.mp3`));
  const avatar = ffprobeDuration(join(ROOT, "assets", "avatars", project, `${id}.mp4`));
  const rendered = ffprobeDuration(join(ROOT, "out", project, `${id}.mp4`));
  const isSilent = !segment.narration || segment.narration.trim() === "";
  const mediaDuration = Math.max(audio ?? 0, avatar ?? 0);
  const expected =
    mediaDuration > 0
      ? isSilent && segment.duration !== undefined
        ? segment.duration
        : Math.max(segment.duration ?? 0, roundedDuration(mediaDuration + (isSilent ? 0.2 : TAIL_PAD_SEC)))
      : segment.duration ?? null;
  const issues: Issue[] = [];
  const add = (level: IssueLevel, message: string) => issues.push({ level, segment: id, message });

  if (!isSilent && segment.duration !== undefined && mediaDuration > 0 && segment.duration < mediaDuration + TAIL_PAD_SEC) {
    add(
      "error",
      `YAML duration ${segment.duration.toFixed(2)}s is shorter than media ${mediaDuration.toFixed(2)}s + tail ${TAIL_PAD_SEC.toFixed(2)}s`,
    );
  }
  if (expected !== null && rendered !== null && Math.abs(rendered - expected) > RENDER_TOLERANCE_SEC) {
    add("warn", `rendered ${rendered.toFixed(2)}s differs from expected ${expected.toFixed(2)}s`);
  }
  if (!isSilent && rendered !== null && audio !== null && rendered < audio + TAIL_PAD_SEC - 0.05) {
    add("error", `rendered ${rendered.toFixed(2)}s leaves less than ${TAIL_PAD_SEC.toFixed(2)}s tail after TTS ${audio.toFixed(2)}s`);
  }
  if (expected !== null) {
    for (const item of collectTimedEnds(segment)) {
      if (item.end > expected + 0.05) {
        add("warn", `${item.label} ends at ${item.end.toFixed(2)}s past expected ${expected.toFixed(2)}s`);
      }
    }
  }

  return {
    id,
    yamlDuration: segment.duration ?? null,
    expectedDuration: expected,
    audioDuration: audio,
    avatarDuration: avatar,
    renderedDuration: rendered,
    issues,
  };
}

function fmt(n: number | null): string {
  return n === null ? "-" : n.toFixed(2);
}

function main() {
  const project = projectName();
  const strict = process.argv.includes("--strict");
  const asJson = process.argv.includes("--json");
  const cfg = loadYaml<ProjectYaml>(join(ROOT, "script", "projects", `${project}.yaml`));
  const reports = cfg.segments.map((id) => auditSegment(project, id));
  const issues = reports.flatMap((r) => r.issues);

  if (asJson) {
    console.log(JSON.stringify({ project, tailPadSec: TAIL_PAD_SEC, reports, issues }, null, 2));
  } else {
    console.log(`Timing audit: ${project} (tail pad ${TAIL_PAD_SEC.toFixed(2)}s)`);
    console.log("segment                         yaml    audio   avatar  expect  render  status");
    for (const r of reports) {
      const status = r.issues.some((i) => i.level === "error")
        ? "ERROR"
        : r.issues.length
        ? "WARN"
        : "ok";
      console.log(
        `${r.id.padEnd(31)} ${fmt(r.yamlDuration).padStart(6)} ${fmt(r.audioDuration).padStart(7)} ` +
          `${fmt(r.avatarDuration).padStart(7)} ${fmt(r.expectedDuration).padStart(7)} ${fmt(r.renderedDuration).padStart(7)}  ${status}`,
      );
    }
    for (const issue of issues) {
      console.log(`[${issue.level}] ${issue.segment}: ${issue.message}`);
    }
  }

  if (strict && issues.some((i) => i.level === "error")) process.exit(1);
}

main();
