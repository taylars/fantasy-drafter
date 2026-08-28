#!/usr/bin/env node
/* Scratch measurement harness (never committed).
 *
 * Calls the SAME runBacktest / simulateDraft / scoreSeason / gradeRuns as
 * bin/backtest.mjs, but only the 'board' arm, and reports per-seed as well as
 * pooled. Nothing here is imported by shipped code.
 */
import { readFile } from "node:fs/promises";
import { loadLocalGrades } from "./bin/lib/grades.mjs";
import { historicalFixture, simulateDraft, scoreSeason, gradeRuns } from "./js/backtest.js";
import { PLAN_AHEAD } from "./js/value.js";

const history = new URL("./data/historical/2025/", import.meta.url);
const draft = JSON.parse(await readFile(new URL("draft.json", history), "utf8"));
const weeks = await Promise.all(Array.from({ length: 17 }, (_, i) => readFile(
  new URL(`weeks/week-${String(i + 1).padStart(2, "0")}.json`, history), "utf8").then(JSON.parse)));
const fixture = historicalFixture(draft, weeks, await loadLocalGrades(draft.season));

const arg = (name, fallback) => {
  const found = process.argv.find((a) => a.startsWith(`--${name}=`));
  return found ? found.split("=")[1] : fallback;
};
const seeds = String(arg("seeds", "1,2,3,4,5,6,7,8")).split(",").map(Number);
const aheads = String(arg("ahead", String(PLAN_AHEAD))).split(",").map(Number);
const teams = 12;

for (const ahead of aheads) {
  const started = Date.now();
  const runs = [];
  const bySeed = new Map();
  for (const seed of seeds) {
    for (let heroSeat = 1; heroSeat <= teams; heroSeat++) {
      const simulation = simulateDraft(fixture, { seed, teams, heroSeat, heroStrategy: "board", ahead });
      const results = scoreSeason(fixture, simulation, {});
      for (const result of results) Object.defineProperty(result, "_teams", { value: teams });
      const run = { heroSeat, seed, simulation, results };
      runs.push(run);
      if (!bySeed.has(seed)) bySeed.set(seed, []);
      bySeed.get(seed).push(run);
    }
  }
  const g = gradeRuns(runs);
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  const per = [...bySeed].map(([seed, group]) => `${seed}:${gradeRuns(group).averagePoints}`).join(" ");
  console.log(`ahead=${ahead}  score ${g.score}  points ${g.averagePoints} ±${g.pointsStandardError} (n=${g.samples})  finish ${g.averageFinish}  allPlay ${g.allPlayWinRate}%  champ ${g.championshipRate}%  [${elapsed}s]`);
  console.log(`   per-seed points: ${per}`);
  const dump = arg("dump", null);
  if (dump) {
    const { writeFileSync } = await import("node:fs");
    writeFileSync(dump, JSON.stringify(runs.map((run) => run.results[run.heroSeat - 1].total)));
  }
}
