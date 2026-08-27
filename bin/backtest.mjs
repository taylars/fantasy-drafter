#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { historicalFixture, runBacktest, runMatrix } from "../js/backtest.js";

const history = new URL("../data/historical/2025/", import.meta.url);
const draft = JSON.parse(await readFile(new URL("draft.json", history), "utf8"));
const weeks = await Promise.all(Array.from({ length: 17 }, (_, i) => readFile(
  new URL(`weeks/week-${String(i + 1).padStart(2, "0")}.json`, history), "utf8").then(JSON.parse)));
const fixture = historicalFixture(draft, weeks);
const json = process.argv.includes("--json");
const aheadArg = process.argv.find((arg) => arg.startsWith("--ahead="));
const ahead = aheadArg ? Number(aheadArg.split("=")[1]) : 2;
const matrix = process.argv.includes("--matrix");
const seedArg = process.argv.find(arg => arg.startsWith('--seed='));
const seed = seedArg ? Number(seedArg.split('=')[1]) : 1;
if (!Number.isSafeInteger(seed)) throw new Error('--seed must be an integer');
const results = matrix ? runMatrix(fixture, { ahead, seed }) : runBacktest(fixture, { ahead, seed });

if (json) {
  const compact = Object.fromEntries(Object.entries(results).map(([name, value]) => [name,
    matrix ? value : value.grade]));
  console.log(JSON.stringify(compact, null, 2));
} else {
  console.log(matrix
    ? `2025 historical matrix — team counts × draft types × rosters × scoring × opponents`
    : `2025 historical backtest — 12-team half-PPR snake, 12 draft slots, Weeks 1–17`);
  console.log(`Archived projection caveat: ${fixture.caveat}`);
  console.log(`Opponent policy: scripted ADP, seed ${seed}`);
  for (const [name, { grade }] of Object.entries(results)) {
    console.log(`\n${name.toUpperCase()}  ${grade.letter} (${grade.score})`);
    console.log(`  points ${grade.averagePoints}  finish ${grade.averageFinish}`);
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
