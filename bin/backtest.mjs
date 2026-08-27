#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { runBacktest, runMatrix } from "../js/backtest.js";

const fixture = JSON.parse(await readFile(
  new URL("../test/fixtures/backtest-2025.json", import.meta.url), "utf8"));
const json = process.argv.includes("--json");
const aheadArg = process.argv.find((arg) => arg.startsWith("--ahead="));
const ahead = aheadArg ? Number(aheadArg.split("=")[1]) : 2;
const matrix = process.argv.includes("--matrix");
const results = matrix ? runMatrix(fixture, { ahead }) : runBacktest(fixture, { ahead });

if (json) {
  const compact = Object.fromEntries(Object.entries(results).map(([name, value]) => [name,
    matrix ? value : value.grade]));
  console.log(JSON.stringify(compact, null, 2));
} else {
  console.log(matrix
    ? `2025 historical matrix — team counts × draft types × rosters × scoring × opponents`
    : `2025 historical backtest — 12-team half-PPR snake, 12 draft slots, Weeks 1–17`);
  console.log(`Archived projection caveat: ${fixture.caveat}`);
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
