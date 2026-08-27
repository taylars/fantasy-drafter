/* Historical draft and season simulation.
 *
 * Draft decisions see only preseason fields. Actual weekly points live on the
 * same fixture rows for convenient scoring, but are never copied into the pool
 * handed to a strategy. That separation is the backtest's most important rule.
 */

import { board, mustFill, situation, DEFAULT_AVAILABILITY } from "./value.js";

export const DEFAULT_SLOTS = [
  "QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "FLEX", "K", "DEF",
  "BN", "BN", "BN", "BN", "BN",
];

export function historicalFixture(draft, weeks) {
  const ordered = weeks.slice().sort((a, b) => a.week - b.week);
  return {
    season: draft.season,
    weeks: ordered.length,
    caveat: draft.caveat,
    players: draft.players.map((player) => ({
      ...player,
      actual: Object.fromEntries(draft.formats.map((format) => [
        format,
        ordered.map((week) => week.points[player.player_id]?.[format] ?? 0),
      ])),
    })),
  };
}

const FLEXABLE = new Set(["RB", "WR", "TE"]);
const POSITION_CAP = { QB: 2, RB: 8, WR: 8, TE: 3, K: 1, DEF: 1 };

export function draftOrder({ teams, rounds, type = "snake", reversalRound = 0 }) {
  const order = [];
  for (let round = 1; round <= rounds; round++) {
    let forward = round % 2 === 1;
    if (reversalRound && round >= reversalRound) forward = !forward;
    if (type === "linear") forward = true;
    for (let n = 0; n < teams; n++) {
      order.push(forward ? n : teams - n - 1);
    }
  }
  return order;
}

function draftShape({ teams, rounds, type, reversalRound }) {
  const draft_order = {};
  for (let seat = 0; seat < teams; seat++) draft_order[`seat-${seat + 1}`] = seat + 1;
  return { teams, rounds, type, reversal_round: reversalRound, draft_order };
}

function count(roster, position) {
  return roster.filter((p) => p.position === position).length;
}

function strategyPool(players, format) {
  return players.map((p) => ({
    player_id: p.player_id,
    name: p.name,
    position: p.position,
    team: p.team,
    injury_status: null,
    adp: typeof p.adp === "number" ? p.adp : p.adp[format],
    points: typeof p.projected === "number" ? p.projected : p.projected[format],
    availability: DEFAULT_AVAILABILITY[p.position] ?? 0.85,
    offense: 0,
    position_security: 0,
    upside: 0,
    graded: false,
  }));
}

export function simulateDraft(fixture, {
  heroSeat = 1,
  heroStrategy = "board",
  teams = 12,
  slots = DEFAULT_SLOTS,
  type = "snake",
  reversalRound = 0,
  ahead = 2,
  format = "half_ppr",
  opponentStyle = "adp",
} = {}) {
  const rounds = slots.length;
  const draft = draftShape({ teams, rounds, type, reversalRound });
  const order = draftOrder({ teams, rounds, type, reversalRound });
  const pool = strategyPool(fixture.players, format)
    .filter((p) => Number.isFinite(p.adp) && Number.isFinite(p.points))
    .sort((a, b) => a.adp - b.adp || a.name.localeCompare(b.name));
  const byId = new Map(pool.map((p) => [p.player_id, p]));
  const rosters = Array.from({ length: teams }, () => []);
  const gone = new Set();
  const picks = [];

  for (let i = 0; i < order.length; i++) {
    const seat = order[i];
    const roster = rosters[seat];
    const available = pool.filter((p) => !gone.has(p.player_id));
    const picksLeft = rounds - roster.length;
    let chosen;

    if (seat + 1 === heroSeat && heroStrategy === "board") {
      const userId = `seat-${heroSeat}`;
      const sit = situation({
        pool,
        slots,
        draft,
        gone,
        ours: new Set(roster.map((p) => p.player_id)),
        atPick: i + 1,
        userIds: new Set([userId]),
      });
      chosen = board(sit, { ahead, limit: pool.length }).ranked[0]?.player;
    } else {
      const style = opponentStyle === "mixed"
        ? ["adp", "robust_rb", "zero_rb", "late_qb"][seat % 4] : opponentStyle;
      chosen = styledChoice(available, roster, slots, picksLeft, style, Math.floor(i / teams) + 1);
    }

    if (!chosen) throw new Error(`no legal player at pick ${i + 1}, seat ${seat + 1}`);
    // Always use the one shared pool object; board rows and ADP candidates both
    // refer to it, but resolving makes that invariant explicit.
    chosen = byId.get(chosen.player_id);
    roster.push(chosen);
    gone.add(chosen.player_id);
    picks.push({ pick: i + 1, seat: seat + 1, player_id: chosen.player_id, name: chosen.name,
                 position: chosen.position, strategy: seat + 1 === heroSeat ? heroStrategy : "adp" });
  }

  return { teams, slots, rosters, picks };
}

function styledChoice(available, roster, slots, picksLeft, style, round) {
  const legal = available.filter((p) => {
    const forced = mustFill(roster, slots, picksLeft);
    return (!forced.size || forced.has(p.position)) &&
      count(roster, p.position) < (POSITION_CAP[p.position] ?? Infinity);
  });
  if (style === "robust_rb" && round <= 3 && count(roster, "RB") < 2) {
    return legal.find((p) => p.position === "RB") ?? legal[0];
  }
  if (style === "zero_rb" && round <= 4) {
    return legal.find((p) => p.position !== "RB") ?? legal[0];
  }
  if (style === "late_qb" && round <= 8) {
    return legal.find((p) => p.position !== "QB") ?? legal[0];
  }
  return legal[0];
}

/* Best legal weekly lineup. Exact slots are settled first; FLEX receives the
 * highest-scoring eligible leftovers. Every required slot is present because
 * the draft enforces legality, but zero is used defensively for a missing one.
 */
export function weeklyLineup(roster, actualById, week, slots = DEFAULT_SLOTS, format = "half_ppr") {
  const unused = new Set(roster.map((p) => p.player_id));
  const assignments = [];
  const points = (p) => {
    const actual = actualById.get(p.player_id)?.actual;
    const weeks = Array.isArray(actual) ? actual : actual?.[format];
    return weeks?.[week] ?? 0;
  };
  const take = (eligible) => {
    const candidates = roster.filter((p) => unused.has(p.player_id) && eligible(p));
    candidates.sort((a, b) => points(b) - points(a) || a.name.localeCompare(b.name));
    const chosen = candidates[0] ?? null;
    if (chosen) unused.delete(chosen.player_id);
    return chosen;
  };

  for (const slot of slots) {
    if (slot === "BN" || slot === "FLEX") continue;
    const player = take((p) => p.position === slot);
    assignments.push({ slot, player, points: player ? points(player) : 0 });
  }
  for (const slot of slots) {
    if (slot !== "FLEX") continue;
    const player = take((p) => FLEXABLE.has(p.position));
    assignments.push({ slot, player, points: player ? points(player) : 0 });
  }

  return {
    points: assignments.reduce((sum, row) => sum + row.points, 0),
    assignments,
  };
}

export function scoreSeason(fixture, simulation, { format = "half_ppr" } = {}) {
  const actualById = new Map(fixture.players.map((p) => [p.player_id, p]));
  const results = simulation.rosters.map((roster, seat) => ({
    seat: seat + 1,
    roster,
    weeks: Array.from({ length: fixture.weeks }, (_, week) =>
      weeklyLineup(roster, actualById, week, simulation.slots, format)),
  }));

  for (const result of results) {
    result.total = result.weeks.reduce((sum, w) => sum + w.points, 0);
    let allPlayWins = 0;
    for (let week = 0; week < fixture.weeks; week++) {
      const mine = result.weeks[week].points;
      for (const other of results) {
        if (other === result) continue;
        const theirs = other.weeks[week].points;
        allPlayWins += mine > theirs ? 1 : mine === theirs ? 0.5 : 0;
      }
    }
    result.allPlay = allPlayWins / (fixture.weeks * (results.length - 1));
    result.highScores = result.weeks.filter((w, week) =>
      w.points === Math.max(...results.map((r) => r.weeks[week].points))).length;
    result.positionPoints = {};
    result.benchContribution = 0;
    result.benchStarts = 0;
    const starterCount = simulation.slots.filter((slot) => slot !== "BN").length;
    const benchDrafted = new Set(result.roster.slice(starterCount).map((p) => p.player_id));
    for (const week of result.weeks) for (const row of week.assignments) {
      const position = row.player?.position ?? row.slot;
      result.positionPoints[position] = (result.positionPoints[position] ?? 0) + row.points;
      if (row.player && benchDrafted.has(row.player.player_id)) {
        result.benchContribution += row.points;
        result.benchStarts++;
      }
    }
  }

  const ordered = results.slice().sort((a, b) => b.total - a.total);
  for (const result of results) result.rank = ordered.indexOf(result) + 1;
  scoreHeadToHead(results, fixture.weeks);
  return results;
}

function roundRobin(teams) {
  const ring = Array.from({ length: teams }, (_, i) => i);
  const rounds = [];
  for (let round = 0; round < teams - 1; round++) {
    const pairs = [];
    for (let i = 0; i < teams / 2; i++) pairs.push([ring[i], ring[teams - 1 - i]]);
    rounds.push(pairs);
    ring.splice(1, 0, ring.pop());
  }
  return rounds;
}

function game(a, b, week) {
  const ap = a.weeks[week].points, bp = b.weeks[week].points;
  if (ap > bp) return a;
  if (bp > ap) return b;
  return a.total >= b.total ? a : b;
}

function scoreHeadToHead(results, weeks) {
  const regularWeeks = Math.min(14, weeks - 3);
  const schedule = roundRobin(results.length);
  for (const result of results) {
    result.wins = 0;
    result.losses = 0;
    result.playoffs = false;
    result.champion = false;
  }
  for (let week = 0; week < regularWeeks; week++) {
    for (const [a, b] of schedule[week % schedule.length]) {
      const winner = game(results[a], results[b], week);
      winner.wins++;
      (winner === results[a] ? results[b] : results[a]).losses++;
    }
  }

  if (results.length < 6 || weeks < regularWeeks + 3) return;
  const seeds = results.slice().sort((a, b) => b.wins - a.wins || b.total - a.total).slice(0, 6);
  seeds.forEach((r) => { r.playoffs = true; });
  const first = [game(seeds[2], seeds[5], regularWeeks), game(seeds[3], seeds[4], regularWeeks)];
  const lower = first[0] === seeds[5] || first[1] === seeds[5] ? seeds[5]
    : first[0] === seeds[4] || first[1] === seeds[4] ? seeds[4] : first[1];
  const higher = first.find((r) => r !== lower);
  const finalists = [game(seeds[0], lower, regularWeeks + 1), game(seeds[1], higher, regularWeeks + 1)];
  game(finalists[0], finalists[1], regularWeeks + 2).champion = true;
}

function letter(score) {
  if (score >= 93) return "A";
  if (score >= 90) return "A-";
  if (score >= 87) return "B+";
  if (score >= 83) return "B";
  if (score >= 80) return "B-";
  if (score >= 77) return "C+";
  if (score >= 73) return "C";
  if (score >= 70) return "C-";
  if (score >= 60) return "D";
  return "F";
}

export function gradeRuns(runs) {
  const hero = runs.map((run) => run.results[run.heroSeat - 1]);
  const pointsPercentile = hero.reduce((sum, r) => sum + (1 - (r.rank - 1) / (runTeams(r) - 1)), 0) / hero.length;
  const allPlay = hero.reduce((sum, r) => sum + r.allPlay, 0) / hero.length;
  const highScore = hero.reduce((sum, r) => sum + r.highScores / r.weeks.length, 0) / hero.length;
  const playoffRate = hero.filter((r) => r.playoffs).length / hero.length;
  const championshipRate = hero.filter((r) => r.champion).length / hero.length;
  // A neutral drafter maps to 75: 50 base points plus half of the available
  // performance points. Rare outcomes are measured against their league base
  // rate (one weekly high and one champion per league), not against 50%.
  const normalizedHigh = hero.reduce((sum, r) =>
    sum + Math.min(1, 0.5 * (r.highScores / r.weeks.length) / (1 / runTeams(r))), 0) / hero.length;
  const normalizedPlayoffs = hero.reduce((sum, r) =>
    sum + Math.min(1, 0.5 * Number(r.playoffs) / (6 / runTeams(r))), 0) / hero.length;
  const normalizedChampionships = hero.reduce((sum, r) =>
    sum + Math.min(1, 0.5 * Number(r.champion) / (1 / runTeams(r))), 0) / hero.length;
  const performance = 0.30 * pointsPercentile + 0.25 * allPlay + 0.15 * normalizedHigh
                    + 0.15 * normalizedPlayoffs + 0.15 * normalizedChampionships;
  const score = 50 + 50 * performance;
  const averagePoints = hero.reduce((sum, r) => sum + r.total, 0) / hero.length;
  return {
    score: Math.round(score * 10) / 10,
    letter: letter(score),
    averagePoints: Math.round(averagePoints * 10) / 10,
    averageFinish: Math.round(hero.reduce((sum, r) => sum + r.rank, 0) / hero.length * 100) / 100,
    pointsPercentile: Math.round(pointsPercentile * 1000) / 10,
    allPlayWinRate: Math.round(allPlay * 1000) / 10,
    weeklyHighScoreRate: Math.round(highScore * 1000) / 10,
    playoffRate: Math.round(playoffRate * 1000) / 10,
    championshipRate: Math.round(championshipRate * 1000) / 10,
    benchContribution: Math.round(hero.reduce((sum, r) => sum + r.benchContribution, 0) / hero.length * 10) / 10,
    benchStarts: Math.round(hero.reduce((sum, r) => sum + r.benchStarts, 0) / hero.length * 10) / 10,
    positionalPoints: Object.fromEntries([...new Set(hero.flatMap((r) => Object.keys(r.positionPoints)))].map((position) => [
      position,
      Math.round(hero.reduce((sum, r) => sum + (r.positionPoints[position] ?? 0), 0) / hero.length * 10) / 10,
    ])),
  };
}

function runTeams(result) {
  // allPlay's denominator is not retained, but a result's rank came from a
  // run whose team count is attached non-enumerably below by runBacktest.
  return result._teams;
}

export function runBacktest(fixture, options = {}) {
  const teams = options.teams ?? 12;
  const strategies = options.strategies ?? ["board", "adp"];
  const output = {};
  for (const strategy of strategies) {
    const runs = [];
    for (let heroSeat = 1; heroSeat <= teams; heroSeat++) {
      const simulation = simulateDraft(fixture, { ...options, teams, heroSeat, heroStrategy: strategy });
      const results = scoreSeason(fixture, simulation, options);
      for (const result of results) Object.defineProperty(result, "_teams", { value: teams });
      runs.push({ heroSeat, simulation, results });
    }
    output[strategy] = { grade: gradeRuns(runs), runs };
  }
  return output;
}

export const ROSTER_SHAPES = {
  classic: ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "K", "DEF", "BN", "BN", "BN", "BN", "BN", "BN"],
  double_flex: DEFAULT_SLOTS,
  three_wr: ["QB", "RB", "RB", "WR", "WR", "WR", "TE", "FLEX", "K", "DEF", "BN", "BN", "BN", "BN", "BN"],
};

export function matrixConfigurations() {
  const configs = [];
  const draftTypes = [
    { draftType: "snake", type: "snake", reversalRound: 0 },
    { draftType: "third_round_reversal", type: "snake", reversalRound: 3 },
    { draftType: "linear", type: "linear", reversalRound: 0 },
  ];
  for (const teams of [8, 10, 12, 14]) for (const draft of draftTypes) {
    for (const [rosterShape, slots] of Object.entries(ROSTER_SHAPES)) {
      for (const format of ["std", "half_ppr", "ppr"]) for (const opponentStyle of ["adp", "mixed"]) {
        configs.push({ teams, ...draft, rosterShape, slots, format, opponentStyle });
      }
    }
  }
  return configs;
}

function groupedGrades(runs, key) {
  const groups = new Map();
  for (const run of runs) {
    const value = String(run.config[key]);
    if (!groups.has(value)) groups.set(value, []);
    groups.get(value).push(run);
  }
  return Object.fromEntries([...groups].map(([value, group]) => [value, gradeRuns(group)]));
}

export function runMatrix(fixture, { ahead = 2 } = {}) {
  const configs = matrixConfigurations();
  const output = {};
  for (const strategy of ["board", "adp"]) {
    const runs = [];
    for (const config of configs) for (let heroSeat = 1; heroSeat <= config.teams; heroSeat++) {
      const simulation = simulateDraft(fixture, { ...config, ahead, heroSeat, heroStrategy: strategy });
      const results = scoreSeason(fixture, simulation, config);
      for (const result of results) Object.defineProperty(result, "_teams", { value: config.teams });
      runs.push({ heroSeat, simulation, results, config });
    }
    output[strategy] = {
      grade: gradeRuns(runs),
      simulations: runs.length,
      breakdown: {
        teams: groupedGrades(runs, "teams"),
        draftType: groupedGrades(runs, "draftType"),
        rosterShape: groupedGrades(runs, "rosterShape"),
        format: groupedGrades(runs, "format"),
        opponentStyle: groupedGrades(runs, "opponentStyle"),
      },
    };
  }
  return output;
}
