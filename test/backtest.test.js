/* The historical backtest is the behavioral specification. Draft strategies
 * see archived projections and ADP; only the season scorer sees actual weekly
 * results. The fixture is frozen so a result cannot change with an API call.
 */

import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SLOTS, historicalFixture, matrixConfigurations, runBacktest, simulateDraft, weeklyLineup } from "../js/backtest.js";

const history = new URL("../data/historical/2025/", import.meta.url);
const historicalDraft = JSON.parse(readFileSync(new URL("draft.json", history), "utf8"));
const historicalWeeks = Array.from({ length: 17 }, (_, i) => JSON.parse(readFileSync(
  new URL(`weeks/week-${String(i + 1).padStart(2, "0")}.json`, history), "utf8")));
const fixture = historicalFixture(historicalDraft, historicalWeeks);
const draft2026 = JSON.parse(readFileSync(
  new URL("../data/historical/2026/draft.json", import.meta.url), "utf8"));

test("the 2025 fixture is a complete frozen regular-season sample", () => {
  assert.equal(fixture.season, "2025");
  assert.equal(fixture.weeks, 17);
  assert.equal(fixture.players.length, 300);
  for (const player of fixture.players) {
    for (const format of ["std", "half_ppr", "ppr"]) {
      assert.equal(player.actual[format].length, 17, `${player.name} ${format}`);
      assert.ok(Number.isFinite(player.adp[format]), `${player.name} ${format}`);
      assert.ok(Number.isFinite(player.projected[format]), `${player.name} ${format}`);
    }
  }
});

test("grades stay attached only to the season in which they were researched", () => {
  assert.ok(historicalDraft.players.every((player) => player.grade === null));
  assert.equal(draft2026.season, "2026");
  assert.equal(draft2026.players.length, 300);
  assert.equal(draft2026.players.filter((player) => player.grade !== null).length, 195);
  assert.ok(draft2026.players.filter((player) => player.grade).every((player) =>
    player.grade.graded_at?.startsWith("2026-") || player.grade.sources?.length));
});

test("the exhaustive matrix covers every requested environment combination", () => {
  const matrix = matrixConfigurations();
  assert.equal(matrix.length, 4 * 3 * 3 * 3 * 2);
  assert.deepEqual([...new Set(matrix.map((c) => c.teams))], [8, 10, 12, 14]);
  assert.deepEqual([...new Set(matrix.map((c) => c.format))], ["std", "half_ppr", "ppr"]);
  assert.deepEqual([...new Set(matrix.map((c) => c.opponentStyle))], ["adp", "mixed"]);
});

test("a simulated draft is deterministic and leaves every team with a legal roster", () => {
  const first = simulateDraft(fixture, { heroSeat: 5, heroStrategy: "board" });
  const second = simulateDraft(fixture, { heroSeat: 5, heroStrategy: "board" });
  assert.deepEqual(first.picks, second.picks);
  assert.equal(first.picks.length, 12 * DEFAULT_SLOTS.length);
  for (const roster of first.rosters) {
    assert.equal(roster.length, DEFAULT_SLOTS.length);
    for (const position of ["QB", "RB", "WR", "TE", "K", "DEF"]) {
      assert.ok(roster.some((p) => p.position === position), `missing ${position}`);
    }
  }
});

test("weekly scoring starts the best legal players rather than the highest bench total", () => {
  const players = [
    { player_id: "q", name: "QB", position: "QB", actual: [20] },
    { player_id: "r1", name: "RB 1", position: "RB", actual: [15] },
    { player_id: "r2", name: "RB 2", position: "RB", actual: [10] },
    { player_id: "r3", name: "RB 3", position: "RB", actual: [12] },
    { player_id: "w1", name: "WR 1", position: "WR", actual: [18] },
    { player_id: "w2", name: "WR 2", position: "WR", actual: [9] },
    { player_id: "w3", name: "WR 3", position: "WR", actual: [11] },
    { player_id: "t", name: "TE", position: "TE", actual: [8] },
    { player_id: "k", name: "K", position: "K", actual: [7] },
    { player_id: "d", name: "DEF", position: "DEF", actual: [6] },
  ];
  const actual = new Map(players.map((p) => [p.player_id, p]));
  const lineup = weeklyLineup(players, actual, 0);
  assert.equal(lineup.points, 116);
  assert.deepEqual(lineup.assignments.filter((r) => r.slot === "FLEX").map((r) => r.player.name),
    ["RB 2", "WR 2"]);
});

test("the current board is graded against actual 2025 outcomes and an ADP baseline", () => {
  const result = runBacktest(fixture);
  assert.ok(result.board.grade.averagePoints > result.adp.grade.averagePoints,
    `board ${result.board.grade.averagePoints}, ADP ${result.adp.grade.averagePoints}`);
  assert.ok(result.board.grade.allPlayWinRate > result.adp.grade.allPlayWinRate);
  assert.ok(result.board.grade.score > result.adp.grade.score);
});
