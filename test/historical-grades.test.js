import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validateGrades, validateGradeCohort } from "../js/grades.js";

const document = JSON.parse(readFileSync(new URL("../data/historical/2025/grades.json", import.meta.url)));
const draft = JSON.parse(readFileSync(new URL("../data/historical/2025/draft.json", import.meta.url)));
const first = Object.keys(document.grades)[0];

test("canonical historical grades reject invalid evidence metadata and grades", () => {
  validateGrades(document);
  validateGradeCohort(document, draft);
  for (const mutate of [
    g => { g.sources[0].published_at = "2025-08-30"; },
    g => { g.sources[0].published_at = "not-a-date"; },
    g => { g.sources[0].updated_at = "2026-01-01"; },
    g => { g.team = "UNKNOWN"; },
    g => { g.exp_games = 18; },
    g => { g.exp_games = NaN; },
    g => { g.evidence_status = undefined; },
    g => { g.offense = g.offense === 2 ? -2 : 2; },
  ]) {
    const changed = structuredClone(document);
    mutate(changed.grades[first]);
    assert.throws(() => validateGrades(changed));
  }
  const missing = structuredClone(document);
  delete missing.grades[first];
  assert.throws(() => validateGradeCohort(missing, draft), /cohort/);
  const extra = structuredClone(document);
  extra.grades.unknown = structuredClone(document.grades[first]);
  assert.throws(() => validateGradeCohort(extra, draft), /cohort/);
  const duplicate = structuredClone(draft);
  duplicate.players[0].grade = document.grades[first];
  assert.throws(() => validateGradeCohort(document, duplicate), /Duplicate grades/);
});
