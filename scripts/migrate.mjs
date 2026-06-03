#!/usr/bin/env node
// Journaled D1 migration runner.
//
// Replaces the old hand-edited `&&` chain in package.json that silently omitted
// any migration file not typed into it (0013_turnkey … 0016_onchain were never
// applied by `db:migrate`, so a fresh DB was missing Turnkey + on-chain tables).
//
// This runner discovers EVERY migrations/NNNN_*.sql by convention, tracks what
// has run in a `schema_migrations` table, and applies only the pending files in
// order — so a new migration can never be left out, and an already-applied one
// is never re-run (which matters because 0013-0015 use non-idempotent
// `ALTER TABLE … ADD COLUMN`).
//
//   node scripts/migrate.mjs --local            apply pending to the local D1
//   node scripts/migrate.mjs --remote           apply pending to the remote D1
//   node scripts/migrate.mjs --remote --baseline mark all current files as
//                                                applied WITHOUT executing them
//                                                (use ONCE on a DB that already
//                                                has the schema, e.g. prod)
//   node scripts/migrate.mjs --dry-run           print the ordered plan, touch
//                                                nothing (no DB, no auth needed)
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const MIGRATIONS_DIR = path.join(ROOT_DIR, "migrations");
export const DB_NAME = "liber";

// Migration files MUST be NNNN_snake_case.sql (zero-padded sequential prefix).
// Anything else is flagged by findMigrationProblems so it can't be silently
// skipped — that omission class is exactly the bug this runner fixes.
const MIGRATION_RE = /^(\d{4})_[a-z0-9_]+\.sql$/;

// ---------------------------------------------------------------------------
// Pure helpers (no DB / no side effects) — imported by test/migrations.test.mjs
// ---------------------------------------------------------------------------

export function listSqlFiles(dir = MIGRATIONS_DIR) {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

export function discoverMigrations(dir = MIGRATIONS_DIR) {
  return listSqlFiles(dir).filter((f) => MIGRATION_RE.test(f));
}

export function findMigrationProblems(dir = MIGRATIONS_DIR) {
  const problems = [];
  const all = listSqlFiles(dir);

  for (const f of all) {
    if (!MIGRATION_RE.test(f)) {
      problems.push(`would be SKIPPED by the runner (bad name): ${f} — expected NNNN_snake_case.sql`);
    }
  }

  const matched = all.filter((f) => MIGRATION_RE.test(f));
  const seen = new Map();
  for (const f of matched) {
    const n = Number(MIGRATION_RE.exec(f)[1]);
    if (seen.has(n)) {
      problems.push(`duplicate migration number ${pad(n)}: ${seen.get(n)} and ${f}`);
    } else {
      seen.set(n, f);
    }
  }

  const numbers = [...seen.keys()].sort((a, b) => a - b);
  for (let i = 0; i < numbers.length; i += 1) {
    if (numbers[i] !== i + 1) {
      problems.push(`numbering not contiguous from 0001: missing ${pad(i + 1)} (next found is ${pad(numbers[i])})`);
      break;
    }
  }

  return problems;
}

export function parseMigrateArgs(argv = []) {
  const args = { local: false, remote: false, baseline: false, dryRun: false, unknown: [] };
  for (const a of argv) {
    if (a === "--local") args.local = true;
    else if (a === "--remote") args.remote = true;
    else if (a === "--baseline") args.baseline = true;
    else if (a === "--dry-run") args.dryRun = true;
    else args.unknown.push(a);
  }
  return args;
}

function pad(n) {
  return String(n).padStart(4, "0");
}

// ---------------------------------------------------------------------------
// wrangler d1 plumbing (side effects)
// ---------------------------------------------------------------------------

const WRANGLER = (() => {
  const local = path.join(ROOT_DIR, "node_modules", ".bin", "wrangler");
  return existsSync(local) ? local : "wrangler";
})();

function wranglerExec(target, extraArgs) {
  const flag = target === "remote" ? "--remote" : "--local";
  const args = ["d1", "execute", DB_NAME, flag, ...extraArgs];
  const res = spawnSync(WRANGLER, args, { encoding: "utf8" });
  if (res.error) throw new Error(`could not run wrangler: ${res.error.message}`);
  if (res.status !== 0) {
    throw new Error(`wrangler ${args.join(" ")} failed:\n${(res.stderr || res.stdout || "").trim()}`);
  }
  return res.stdout || "";
}

// wrangler --json may wrap the array in log noise; pull out the first [...] block.
function extractJson(stdout) {
  const start = stdout.indexOf("[");
  const end = stdout.lastIndexOf("]");
  if (start === -1 || end === -1 || end < start) return [];
  try {
    return JSON.parse(stdout.slice(start, end + 1));
  } catch {
    return [];
  }
}

function ensureJournal(target) {
  wranglerExec(target, [
    "--command",
    "CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)",
  ]);
}

function readApplied(target) {
  const parsed = extractJson(wranglerExec(target, ["--command", "SELECT name FROM schema_migrations", "--json"]));
  const rows = Array.isArray(parsed) ? parsed.flatMap((r) => (r && r.results) || []) : [];
  return new Set(rows.map((r) => r.name));
}

function applyMigration(target, file) {
  wranglerExec(target, ["--file", path.join(MIGRATIONS_DIR, file)]);
}

function recordApplied(target, file) {
  // `file` is validated against MIGRATION_RE, so it can't contain a quote — safe to inline.
  wranglerExec(target, [
    "--command",
    `INSERT OR IGNORE INTO schema_migrations (name, applied_at) VALUES ('${file}', ${Date.now()})`,
  ]);
}

function runMigrations(target, { baseline = false, dryRun = false } = {}) {
  const files = discoverMigrations();
  const problems = findMigrationProblems();
  if (problems.length) {
    for (const p of problems) console.error(`  ✗ ${p}`);
    throw new Error(`refusing to run with ${problems.length} migration problem(s) above`);
  }

  if (dryRun) {
    console.log(`Dry run — ${files.length} migration(s) discovered (would target: ${target}):`);
    for (const f of files) console.log(`  • ${f}`);
    console.log("\nWithout --dry-run, only files absent from schema_migrations are applied (in order).");
    return;
  }

  ensureJournal(target);
  const applied = readApplied(target);
  const pending = files.filter((f) => !applied.has(f));

  if (baseline) {
    if (!pending.length) return void console.log(`Baseline (${target}): journal already up to date.`);
    console.log(`Baseline (${target}): marking ${pending.length} migration(s) applied WITHOUT executing them:`);
    for (const f of pending) {
      recordApplied(target, f);
      console.log(`  ✓ baselined ${f}`);
    }
    console.log("Use this only when the DB already has these schemas (e.g. prod).");
    return;
  }

  if (!pending.length) return void console.log(`Up to date — all ${files.length} migration(s) already applied (${target}).`);
  console.log(`Applying ${pending.length} pending migration(s) to ${target}:`);
  for (const f of pending) {
    process.stdout.write(`  → ${f} … `);
    applyMigration(target, f);
    recordApplied(target, f);
    console.log("ok");
  }
  console.log("Done.");
}

function main(argv) {
  const args = parseMigrateArgs(argv);
  if (args.unknown.length) {
    console.error(`Unknown argument(s): ${args.unknown.join(", ")}`);
    process.exitCode = 1;
    return;
  }
  if (args.dryRun) {
    runMigrations(args.remote ? "remote" : "local", { dryRun: true });
    return;
  }
  if (args.local === args.remote) {
    console.error("Specify exactly one target: --local or --remote.");
    console.error("  add --baseline to mark files applied without executing (existing DBs, e.g. prod)");
    console.error("  add --dry-run to print the plan without touching any DB");
    process.exitCode = 1;
    return;
  }
  runMigrations(args.remote ? "remote" : "local", { baseline: args.baseline });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    main(process.argv.slice(2));
  } catch (err) {
    console.error(`\nMigration failed: ${err.message}`);
    process.exitCode = 1;
  }
}
