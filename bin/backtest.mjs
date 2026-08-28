#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { loadLocalGrades, readProjectJson } from "./lib/grades.mjs";
import { historicalFixture, runBacktest, runMatrix, gradeRuns } from "../js/backtest.js";
import { PLAN_AHEAD } from "../js/value.js";
import { indexedSeasons } from "../js/grades.js";
import { matrixProgress } from "./lib/progress.mjs";

/* A season's grades are optional here. Seasons captured to widen the backtest
 * start ungraded, and the value formula already treats a null grade as neutral
 * — so an ungraded season measures the same strategy against real ADP,
 * projections and results, just without the context corrections. It is not a
 * substitute for grading; the run says so on every line it prints.
 */
async function loadFixture(season) {
  const history = `data/historical/${season}/`;
  const draft = await readProjectJson(`${history}draft.json`);
  const weeks = await Promise.all(Array.from({ length: 17 }, (_, i) =>
    readProjectJson(`${history}weeks/week-${String(i + 1).padStart(2, "0")}.json`)));
  let grades, graded = true;
  try {
    grades = await loadLocalGrades(draft.season);
  } catch (error) {
    if (!/ENOENT|Couldn't load/.test(String(error))) throw error;
    grades = { season: draft.season, grades: {} };
    graded = false;
  }
  return { ...historicalFixture(draft, weeks, grades), graded };
}

const json = process.argv.includes("--json");
const aheadArg = process.argv.find((arg) => arg.startsWith("--ahead="));
const ahead = aheadArg ? Number(aheadArg.split("=")[1]) : PLAN_AHEAD;
const matrix = process.argv.includes("--matrix");
const seedArg = process.argv.find(arg => arg.startsWith('--seed='));
const seed = seedArg ? Number(seedArg.split('=')[1]) : 1;
if (!Number.isSafeInteger(seed)) throw new Error('--seed must be an integer');
// Several rooms instead of one. Twelve seats against a single scripted room is
// too few seasons to read a change off; --seeds=1,2,3,4 pools them.
const seedsArg = process.argv.find(arg => arg.startsWith('--seeds='));
const seeds = seedsArg ? seedsArg.split('=')[1].split(',').map(Number) : [seed];
if (seeds.some(s => !Number.isSafeInteger(s))) throw new Error('--seeds must be integers');
if (matrix && seedsArg) throw new Error('--matrix uses one --seed=N; --seeds is only supported by the normal backtest');

/* Which seasons to run. One season stays the default so every recorded
 * measurement keeps its meaning; --seasons=all is the wider read.
 */
const DEFAULT_SEASON = "2025";
const seasonArg = process.argv.find(arg => arg.startsWith('--season='))?.split('=')[1];
const seasonsArg = process.argv.find(arg => arg.startsWith('--seasons='))?.split('=')[1];
if (seasonArg && seasonsArg) throw new Error('Choose --season or --seasons');
const available = indexedSeasons(await readProjectJson("data/historical/index.json"));
let seasons;
if (seasonsArg) {
  seasons = seasonsArg === "all" ? [...available].sort() : seasonsArg.split(',').map(String);
} else {
  seasons = [seasonArg ?? DEFAULT_SEASON];
}
// A season with no weekly results cannot be scored; --seasons=all should skip
// the upcoming season rather than fail the whole run.
const scorable = [];
for (const season of seasons) {
  try {
    await readProjectJson(`data/historical/${season}/weeks/week-17.json`);
    scorable.push(season);
  } catch {
    if (!seasonsArg || seasonsArg !== "all") throw new Error(`${season} has no week-17 results to score`);
    console.error(`skipping ${season}: no weekly results captured yet`);
  }
}
if (!scorable.length) throw new Error("No scorable seasons selected");
if (matrix && scorable.length > 1) throw new Error('--matrix runs one season; use --season=YYYY');

const perSeason = [];
for (const season of scorable) {
  const fixture = await loadFixture(season);
  const results = matrix
    ? runMatrix(fixture, { ahead, seed, onProgress: !process.argv.includes('--quiet') ? matrixProgress() : undefined })
    : runBacktest(fixture, { ahead, seed, seeds });
  perSeason.push({ season, fixture, results });
}

// Pool by concatenating the underlying runs, so the pooled number uses the same
// estimator as a single season rather than an average of averages.
const pooled = {};
if (!matrix && perSeason.length > 1) {
  for (const strategy of Object.keys(perSeason[0].results)) {
    pooled[strategy] = gradeRuns(perSeason.flatMap(s => s.results[strategy].runs));
  }
}

if (json) {
  const seasonsOut = Object.fromEntries(perSeason.map(({ season, results }) => [season,
    Object.fromEntries(Object.entries(results).map(([name, value]) => [name, matrix ? value : value.grade]))]));
  console.log(JSON.stringify(perSeason.length > 1 ? { seasons: seasonsOut, pooled } : seasonsOut[scorable[0]], null, 2));
} else {
  const label = matrix
    ? `historical matrix — team counts × draft types × rosters × scoring × opponents`
    : `historical backtest — 12-team half-PPR snake, 12 draft slots, Weeks 1–17`;
  console.log(`${scorable.join(", ")} ${label}`);
  console.log(`Opponent policy: scripted ADP, seed${seeds.length > 1 ? 's' : ''} ${seeds.join(',')}`);
  for (const { season, fixture, results } of perSeason) {
    console.log(`\n=== ${season}${fixture.graded ? "" : "  [UNGRADED — neutral context defaults]"} ===`);
    console.log(`Archived projection caveat: ${fixture.caveat}`);
    for (const [name, { grade }] of Object.entries(results)) {
      console.log(`\n${name.toUpperCase()}  ${grade.letter} (${grade.score})`);
      console.log(`  points ${grade.averagePoints} ±${grade.pointsStandardError} (n=${grade.samples})  finish ${grade.averageFinish}`);
      console.log(`  points percentile ${grade.pointsPercentile}%  all-play ${grade.allPlayWinRate}%  weekly highs ${grade.weeklyHighScoreRate}%`);
      console.log(`  playoffs ${grade.playoffRate}%  championships ${grade.championshipRate}%`);
      console.log(`  bench-drafted contribution ${grade.benchContribution} points across ${grade.benchStarts} starts`);
      console.log(`  positional points ${Object.entries(grade.positionalPoints).map(([p, n]) => `${p} ${n}`).join(" · ")}`);
      if (matrix) {
        console.log(`  simulations ${results[name].simulations}`);
        for (const [dimension, groups] of Object.entries(results[name].breakdown)) {
          console.log(`  ${dimension}: ${Object.entries(groups).map(([key, g]) => `${key} ${g.letter}/${g.score}`).join(" · ")}`);
        }
      }
    }
  }
  if (Object.keys(pooled).length) {
    console.log(`\n=== POOLED across ${scorable.length} seasons ===`);
    for (const [name, grade] of Object.entries(pooled)) {
      console.log(`${name.toUpperCase()}  ${grade.letter} (${grade.score})  points ${grade.averagePoints} ±${grade.pointsStandardError} (n=${grade.samples})  finish ${grade.averageFinish}`);
    }
  }
}
