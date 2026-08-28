/* The historical backtest is the behavioral specification. Draft strategies
 * see archived projections and ADP; only the season scorer sees actual weekly
 * results. The fixture is frozen so a result cannot change with an API call.
 */

import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { missingStarters } from '../js/draft-policy.js';
import { DEFAULT_SLOTS, historicalFixture, matrixConfigurations, runBacktest, simulateDraft, strategyPool, weeklyLineup, weeklyReplacements, scoreSeason } from "../js/backtest.js";
import { parseCsv, injuryDesignation } from '../js/historical-week.js';
import { PLAN_AHEAD } from '../js/value.js';
import { runMatrix } from '../js/backtest.js';
import { matrixProgress } from '../bin/lib/progress.mjs';

const history = new URL("../data/historical/2025/", import.meta.url);
const historicalDraft = JSON.parse(readFileSync(new URL("draft.json", history), "utf8"));
const grades2025 = JSON.parse(readFileSync(new URL("grades.json", history), "utf8"));
const grades2026 = JSON.parse(readFileSync(new URL("../2026/grades.json", history), "utf8"));
const historicalWeeks = Array.from({ length: 17 }, (_, i) => JSON.parse(readFileSync(
  new URL(`weeks/week-${String(i + 1).padStart(2, "0")}.json`, history), "utf8")));
const fixture = historicalFixture(historicalDraft, historicalWeeks, grades2025);

test('matrix progress counts drafts without changing results', () => {
  const configs = [matrixConfigurations()[0]];
  const events = [];
  const options = { configs, ahead: 1, seed: 7 };
  const result = runMatrix(fixture, { ...options, onProgress: event => events.push(event) });
  assert.deepEqual(result, runMatrix(fixture, options));
  const total = configs[0].teams * 2;
  assert.equal(events[0].type, 'start');
  assert.equal(events.at(-1).type, 'complete');
  assert.equal(events.at(-1).completed, total);
  assert.ok(events.every(e => e.total === total && e.seed === 7));
  assert.deepEqual(events.filter(e => e.type === 'draft').map(e => e.completed),
    Array.from({ length: total }, (_, i) => i + 1));
  assert.deepEqual(events.filter(e => e.type === 'configuration').map(e => e.strategy), ['board', 'adp']);
});

test('matrix logger emits configuration changes and throttled draft progress', () => {
  let time = 0;
  const lines = [];
  const log = matrixProgress({ write: line => lines.push(line), now: () => time });
  const base = { configurations: 216, total: 4752, completed: 0, seed: 1,
    strategy: 'board', configIndex: 1, config: matrixConfigurations()[0], heroSeat: 0 };
  log({ ...base, type: 'start' });
  log({ ...base, type: 'configuration' });
  time = 1000;
  log({ ...base, type: 'draft', completed: 1, heroSeat: 1 });
  assert.equal(lines.length, 2);
  time = 5000;
  log({ ...base, type: 'draft', completed: 2, heroSeat: 2 });
  assert.match(lines[2], /seat 2\/8.*2\/4752.*elapsed 5s.*rough ETA/);
  log({ ...base, type: 'configuration', strategy: 'adp' });
  assert.match(lines[3], /ADP/);
  log({ ...base, type: 'complete', completed: 4752 });
  assert.match(lines[4], /Complete: 4752\/4752 drafts \(100%\)/);
  assert.ok(lines.every(line => !/NaN|Infinity/.test(line)));
});
const draft2026 = JSON.parse(readFileSync(
  new URL("../data/historical/2026/draft.json", import.meta.url), "utf8"));

test("backtest defaults use the production planning horizon", () => {
  const options = { teams: 8, heroSeat: 4, seed: 3 };
  assert.deepEqual(simulateDraft(fixture, options).picks,
    simulateDraft(fixture, { ...options, ahead: PLAN_AHEAD }).picks);
});

test("pooled backtests retain each seed and report the sample mean and standard error", () => {
  const { adp } = runBacktest(fixture, { teams: 8, strategies: ['adp'], seeds: [3, 7] });
  assert.equal(adp.runs.length, 16);
  assert.deepEqual(adp.runs.map(run => run.seed), [...Array(8).fill(3), ...Array(8).fill(7)]);
  assert.equal(adp.grade.samples, 16);
  const totals = adp.runs.map(run => run.results[run.heroSeat - 1].total);
  const mean = totals.reduce((sum, total) => sum + total, 0) / totals.length;
  const variance = totals.reduce((sum, total) => sum + (total - mean) ** 2, 0) / (totals.length - 1);
  assert.equal(adp.grade.averagePoints, Math.round(mean * 10) / 10);
  assert.equal(adp.grade.pointsStandardError, Math.round(Math.sqrt(variance / totals.length) * 10) / 10);
  assert.deepEqual(runBacktest(fixture, { teams: 8, strategies: ['adp'], seed: 3 }).adp,
    runBacktest(fixture, { teams: 8, strategies: ['adp'], seeds: [3] }).adp);
});

test("the 2025 fixture is a complete frozen regular-season sample", () => {
  assert.equal(fixture.season, "2025");
  assert.equal(fixture.weeks, 17);
  assert.equal(fixture.players.length, 300);
  for (const player of fixture.players) {
    for (const format of ["std", "half_ppr", "ppr"]) {
      assert.equal(player.actual[format].length, 17, `${player.name} ${format}`);
      assert.equal(player.weeklyProjected[format].length, 17);
      assert.ok(Number.isFinite(player.adp[format]), `${player.name} ${format}`);
      assert.ok(Number.isFinite(player.projected[format]), `${player.name} ${format}`);
    }
  }
});

test("grades stay attached only to the season in which they were researched", () => {
  const graded = fixture.players.filter((player) => player.grade !== null);
  assert.equal(graded.length, 200);
  const wanted = historicalDraft.players.filter((p) => !["K", "DEF"].includes(p.position))
    .sort((a, b) => Math.min(...Object.values(a.adp)) - Math.min(...Object.values(b.adp))).slice(0, 200);
  assert.deepEqual(new Set(graded.map((p) => p.player_id)), new Set(wanted.map((p) => p.player_id)));
  const offense = new Map();
  for (const player of graded) {
    const grade = player.grade;
    assert.equal(grade.as_of, "2025-08-29T23:59:59");
    assert.ok(["researched", "conservative_default"].includes(grade.evidence_status));
    for (const source of [...grade.sources, grade.offense_source]) {
      assert.ok(Number.isFinite(Date.parse(source.published_at)));
      assert.ok(source.published_at.slice(0, 10) <= "2025-08-29");
    }
    if (offense.has(player.team)) assert.equal(grade.offense, offense.get(player.team));
    offense.set(player.team, grade.offense);
  }
  assert.equal(offense.size, 32);
  assert.equal(draft2026.season, "2026");
  assert.equal(draft2026.players.length, 300);
  assert.equal(Object.keys(grades2026.grades).length, 200);
  assert.ok(draft2026.players.every((player) => !("grade" in player)));
  assert.throws(() => historicalFixture(historicalDraft, historicalWeeks, grades2026), /season mismatch/);
  assert.throws(() => historicalFixture(historicalDraft, historicalWeeks), /season mismatch/);
});

test("draft strategies consume only season grades, never actuals or current injury status", () => {
  const input = [{player_id: "test", name: "Test", position: "RB", team: "BUF",
    adp: {ppr: 5}, projected: {ppr: 200}, actual: {ppr: [999]}, injury_status: "IR",
    grade: {offense: 2, position_security: 1, upside: 2, exp_games: 12}}];
  const [player] = strategyPool(input, "ppr");
  assert.equal(player.offense, 2);
  assert.equal(player.position_security, 1);
  assert.equal(player.upside, 2);
  assert.equal(player.availability, 12 / 17);
  assert.equal(player.graded, true);
  assert.equal(player.injury_status, null);
  assert.ok(!("actual" in player));
  assert.ok(!("grade" in player));
  input[0].grade = null;
  assert.equal(strategyPool(input, "ppr")[0].graded, false);
  assert.equal(strategyPool(input, "ppr")[0].offense, 0);
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
    assert.equal(missingStarters(roster, DEFAULT_SLOTS), 0);
    for (const position of ["QB", "RB", "WR", "TE", "K", "DEF"]) {
      assert.ok(roster.some((p) => p.position === position), `missing ${position}`);
    }
  }
});

test("weekly scoring starts the highest projected legal players, not hindsight winners", () => {
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
  for (const player of players) player.weeklyProjected = [...player.actual];
  // A bench explosion must not change the lineup selected before the games.
  players.find(p => p.player_id === 'r3').weeklyProjected = [1];
  players.find(p => p.player_id === 'r3').actual = [80];
  players.push({ player_id: 'w4', name: 'WR 4', position: 'WR', weeklyProjected: [10], actual: [4] });
  const actual = new Map(players.map((p) => [p.player_id, p]));
  const lineup = weeklyLineup(players, actual, 0);
  assert.equal(lineup.points, 108);
  assert.deepEqual(lineup.assignments.filter((r) => r.slot === "FLEX").map((r) => r.player.name),
    ["WR 4", "WR 2"]);
});

test('replacement baseline selects top ten free agents by projection, averages actuals', () => {
  const players = Array.from({ length: 12 }, (_, i) => ({
    player_id: String(i), name: `RB ${i}`, position: 'RB', scheduled: [true],
    weeklyProjected: { half_ppr: [20 - i] }, actual: { half_ppr: [i] },
  }));
  players[11].actual.half_ppr[0] = 100; // Hindsight cannot promote this player.
  const baseline = weeklyReplacements(players, new Set(['0']), 0);
  assert.deepEqual(baseline.RB.playerIds, players.slice(1, 11).map(p => p.player_id));
  assert.equal(baseline.RB.points, 5.5);
  assert.equal(baseline.RB.projected, 14.5);
  players[1].injured = [true];
  players[2].scheduled = [false];
  const fewer = weeklyReplacements(players.slice(0, 4), new Set(['0']), 0);
  assert.deepEqual(fewer.RB.playerIds, ['3']);
  assert.equal(fewer.RB.points, 3);
  assert.deepEqual(weeklyReplacements(players, new Set(players.map(p => p.player_id)), 0), {});
});

test('injured slots use replacement scores only when selected; bench depth still competes', () => {
  const injured = { player_id: 'i', name: 'Injured', position: 'RB', injured: [true], scheduled: [true],
    weeklyProjected: [0], actual: [0] };
  const bench = { player_id: 'b', name: 'Bench', position: 'RB', weeklyProjected: [8], actual: [30] };
  const roster = [injured, bench];
  const data = new Map(roster.map(p => [p.player_id, p]));
  const replacements = { RB: { projected: 10, points: 6, playerIds: ['free'] } };
  const run = () => weeklyLineup(roster, data, 0, ['RB', 'BN'], 'half_ppr', replacements);
  assert.equal(run().points, 6);
  assert.equal(run().assignments[0].player.player_id, 'i');
  assert.deepEqual(run().assignments[0].replacement.playerIds, ['free']);
  bench.weeklyProjected[0] = 11;
  assert.equal(run().points, 30);
  assert.equal(run().assignments[0].replacement, undefined);
  bench.actual[0] = 0; // Healthy zero is not entitled to replacement credit.
  assert.equal(run().points, 0);
  bench.scheduled = [false]; injured.scheduled = [false];
  assert.equal(run().points, 0); // Neither byes nor missing projections earn credit.
  injured.scheduled = [true];
  assert.equal(weeklyLineup(roster, data, 0, ['RB']).points, 0);
});

test('weekly inputs never leak to draft strategies and missing archives fail explicitly', () => {
  const [player] = strategyPool(fixture.players, 'ppr');
  for (const key of ['weeklyProjected', 'actual', 'injured', 'scheduled']) assert.ok(!(key in player));
  assert.ok(fixture.replacementPlayers.length > 0);
  assert.equal(strategyPool(fixture.players, 'ppr').length, 300);
  assert.throws(() => historicalFixture(historicalDraft, [{ week: 1, points: {} }], grades2025), /Missing weekly lineup inputs/);
});

test('historical injury mapping excludes suspension, retirement and questionable status', () => {
  assert.equal(injuryDesignation(null, { report_status: 'Out' }), 'Out');
  for (const code of ['R01', 'R48', 'R04', 'R05', 'R27']) {
    assert.ok(injuryDesignation({ status: 'RES', status_description_abbr: code }, null));
  }
  for (const code of ['R40', 'R02', 'R09']) {
    assert.equal(injuryDesignation({ status: 'RES', status_description_abbr: code }, null), null);
  }
  assert.equal(injuryDesignation(null, { report_status: 'Questionable' }), null);
  assert.deepEqual(parseCsv('name,url,status\r\n"A ""Name""","https://a,b",RES\r\n'),
    [{ name: 'A "Name"', url: 'https://a,b', status: 'RES' }]);
});

test('season replacement pool excludes other teams and respects scoring format', () => {
  const player = (id, projection, actual, injured = false) => ({
    player_id: id, name: id, position: 'RB', scheduled: [true], injured: [injured],
    weeklyProjected: { ppr: [projection], std: [projection / 2] },
    actual: { ppr: [actual], std: [actual / 2] },
  });
  const injured = player('injured', 0, 0, true);
  const opponent = player('opponent', 50, 100);
  const free = player('free', 10, 8);
  const input = { weeks: 1, players: [injured, opponent], replacementPlayers: [free] };
  const simulation = { rosters: [[injured], [opponent]], slots: ['RB'] };
  assert.equal(scoreSeason(input, simulation, { format: 'ppr' })[0].total, 8);
  assert.equal(scoreSeason(input, simulation, { format: 'std' })[0].total, 4);
  const selected = scoreSeason(input, simulation, { format: 'ppr' })[0].weeks[0].assignments[0];
  assert.deepEqual(selected.replacement.playerIds, ['free']);
});

test('frozen data distinguishes scored games from injury absences and byes', () => {
  for (const player of fixture.players) for (let week = 0; week < fixture.weeks; week++) {
    if (player.actual.ppr[week] !== 0) {
      assert.equal(player.scheduled[week], true, `${player.name} week ${week + 1}`);
      assert.equal(player.injured[week], false, `${player.name} week ${week + 1}`);
    }
  }
  const puka = fixture.players.find(p => p.name === 'Puka Nacua');
  assert.equal(puka.scheduled[0], true); // nflverse LA must map to Sleeper LAR.
});

test('scripted rooms vary by seed while preserving full roster legality', () => {
  const first = simulateDraft(fixture, { heroStrategy: 'adp', opponentStyle: 'mixed', seed: 1 });
  const second = simulateDraft(fixture, { heroStrategy: 'adp', opponentStyle: 'mixed', seed: 42 });
  assert.notDeepEqual(first.picks, second.picks);
  for (const draft of [first, second]) {
    assert.equal(new Set(draft.picks.map(p => p.player_id)).size, draft.picks.length);
    for (const roster of draft.rosters) assert.equal(missingStarters(roster, DEFAULT_SLOTS), 0);
    assert.ok(draft.picks.filter(p => p.seat === 1).every(p => p.strategy === 'adp'));
    assert.ok(draft.picks.filter(p => p.seat === 2).every(p => p.strategy === 'robust_rb'));
  }
});

test("the current board is graded against actual 2025 outcomes and an ADP baseline", () => {
  const result = runBacktest(fixture);
  // This is an evaluation, not a promise that our algorithm wins. Stronger
  // opponents must be allowed to expose a worse result without breaking CI.
  for (const strategy of ['board', 'adp']) {
    assert.equal(result[strategy].runs.length, 12);
    assert.ok(Number.isFinite(result[strategy].grade.averagePoints));
    assert.ok(result[strategy].grade.score >= 0 && result[strategy].grade.score <= 100);
  }
});
