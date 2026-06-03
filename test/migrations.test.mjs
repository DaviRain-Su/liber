import assert from "node:assert/strict";
import test from "node:test";

import {
  discoverMigrations,
  findMigrationProblems,
  listSqlFiles,
  parseMigrateArgs,
} from "../scripts/migrate.mjs";

// The whole point of the journaled runner: every migrations/*.sql is discovered
// by convention, so none can be silently left out of the migrate command (the
// bug where 0013_turnkey … 0016_onchain were never applied by `db:migrate`).

test("every .sql in migrations/ is discovered by the runner (no silent skips)", () => {
  const all = listSqlFiles();
  const discovered = discoverMigrations();
  assert.equal(all.length, discovered.length, `un-discovered .sql files: ${all.filter((f) => !discovered.includes(f)).join(", ")}`);
  assert.equal(all.length > 0, true);
});

test("migration numbering is contiguous, unique, and well-named", () => {
  assert.deepEqual(findMigrationProblems(), []);
});

test("discovered migrations are sorted and include the Turnkey + on-chain set", () => {
  const files = discoverMigrations();
  assert.deepEqual([...files].sort(), files); // already in order
  for (const f of ["0013_turnkey.sql", "0014_turnkey_chains.sql", "0015_turnkey_passkey.sql", "0016_onchain.sql"]) {
    assert.equal(files.includes(f), true, `missing ${f}`);
  }
});

test("findMigrationProblems flags a badly-named (skippable) file", () => {
  const problems = findMigrationProblems(new URL("./fixtures/bad-migrations", import.meta.url).pathname);
  assert.equal(problems.some((p) => p.includes("SKIPPED")), true);
});

test("findMigrationProblems flags a numbering gap", () => {
  const problems = findMigrationProblems(new URL("./fixtures/gap-migrations", import.meta.url).pathname);
  assert.equal(problems.some((p) => p.includes("not contiguous")), true);
});

test("parseMigrateArgs reads target / baseline / dry-run flags", () => {
  assert.deepEqual(parseMigrateArgs(["--remote"]), { local: false, remote: true, baseline: false, dryRun: false, unknown: [] });
  assert.deepEqual(parseMigrateArgs(["--local", "--baseline"]), { local: true, remote: false, baseline: true, dryRun: false, unknown: [] });
  assert.deepEqual(parseMigrateArgs(["--dry-run"]).dryRun, true);
  assert.deepEqual(parseMigrateArgs(["--bogus"]).unknown, ["--bogus"]);
});
