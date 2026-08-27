import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, cpSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const script = fileURLToPath(new URL("../bin/historical-grades.mjs", import.meta.url));
const source = fileURLToPath(new URL("../data/historical/2025/", import.meta.url));

test("historical grade checks reject invalid evidence metadata without writing", () => {
  const cwd = mkdtempSync(join(tmpdir(), "historical-grades-"));
  try {
    const destination = join(cwd, "data/historical/2025");
    cpSync(source, destination, { recursive: true });
    const draft = join(destination, "draft.json");
    const before = readFileSync(draft, "utf8");
    const batchPath = join(destination, "grades/graded-01.json");
    const original = JSON.parse(readFileSync(batchPath, "utf8"));
    const run = (...args) => spawnSync(process.execPath, [script, ...args], { cwd, encoding: "utf8" });
    assert.equal(run("--check").status, 0);
    assert.equal(run("--help").status, 0);
    assert.equal(run("--typo").status, 2);
    for (const mutate of [
      (b) => { b.players[0].sources[0].published_at = "2025-08-30"; },
      (b) => { b.players[0].sources[0].published_at = "not-a-date"; },
      (b) => { b.players[0].sources[0].updated_at = "2026-01-01"; },
      (b) => { b.players[0].team_as_of_cutoff = "UNKNOWN"; },
      (b) => { b.players[0].exp_games = 18; },
      (b) => { b.players[0].evidence_status = undefined; },
      (b) => { b.players.push(b.players[0]); },
      (b) => { b.players.pop(); },
    ]) {
      const changed = structuredClone(original);
      mutate(changed);
      writeFileSync(batchPath, JSON.stringify(changed));
      const result = run("--check");
      assert.equal(result.status, 1, result.stdout + result.stderr);
      assert.equal(readFileSync(draft, "utf8"), before);
    }
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
