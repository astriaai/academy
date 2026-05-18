/**
 * Detect which course projects a PR touches, so CI rebuilds only those.
 *
 *   tsx pipeline/ci/affected.ts [--base <ref>]
 *
 * Base ref precedence: --base arg > BASE_REF env > origin/main.
 *
 * Output:
 *   - stdout: space-separated project list (empty line if none)
 *   - $GITHUB_OUTPUT (when set): `projects=<json-array>` and `any=<bool>`
 *
 * Rules:
 *   - A change to shared code (pipeline/, layouts/, compositions/,
 *     hyperframes.json, package*.json) marks *every* project affected.
 *   - A change scoped to script/projects/<P>.yaml or script/segments/<P>/**
 *     marks only project P.
 *   - An unresolvable base ref (shallow clone, first push) marks every
 *     project affected — safe default.
 */
import { spawnSync } from "node:child_process";
import { appendFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", ".."); // webinar-builder/

function git(args: string[]): string {
  const r = spawnSync("git", args, { cwd: ROOT, encoding: "utf-8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
  return r.stdout.trim();
}

/** All known projects = every manifest under script/projects/. */
function allProjects(): string[] {
  return readdirSync(join(ROOT, "script", "projects"))
    .filter((f) => f.endsWith(".yaml"))
    .map((f) => f.replace(/\.yaml$/, ""))
    .sort();
}

function parseBase(): string {
  const i = process.argv.indexOf("--base");
  if (i !== -1 && process.argv[i + 1]) return process.argv[i + 1]!;
  return process.env.BASE_REF || "origin/main";
}

function main() {
  const projects = allProjects();
  const base = parseBase();

  // webinar-builder path relative to the git root (usually "webinar-builder").
  const gitRoot = git(["rev-parse", "--show-toplevel"]);
  const rel = resolve(ROOT).slice(gitRoot.length + 1).replace(/\\/g, "/");
  const wb = rel ? `${rel}/` : "";

  let changed: string[] = [];
  let resolved = true;
  try {
    changed = git(["diff", "--name-only", `${base}...HEAD`]).split("\n").filter(Boolean);
  } catch {
    resolved = false; // base unavailable — rebuild everything
  }

  const sharedRe = new RegExp(
    `^${wb}(pipeline/|layouts/|compositions/|hyperframes\\.json|package(-lock)?\\.json)`,
  );
  const projectYamlRe = new RegExp(`^${wb}script/projects/([^/]+)\\.yaml$`);
  const segmentRe = new RegExp(`^${wb}script/segments/([^/]+)/`);

  const affected = new Set<string>();
  let allHit = !resolved;
  for (const f of changed) {
    if (sharedRe.test(f)) { allHit = true; break; }
    const py = f.match(projectYamlRe);
    if (py) { affected.add(py[1]!); continue; }
    const sg = f.match(segmentRe);
    if (sg) { affected.add(sg[1]!); continue; }
  }

  const result = allHit ? projects : projects.filter((p) => affected.has(p));

  process.stdout.write(result.join(" ") + "\n");
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `projects=${JSON.stringify(result)}\n`);
    appendFileSync(process.env.GITHUB_OUTPUT, `any=${result.length > 0}\n`);
  }
  console.error(
    `[affected] base=${base} resolved=${resolved} changed=${changed.length} ` +
      `→ ${result.length ? result.join(", ") : "(none)"}`,
  );
}

main();
