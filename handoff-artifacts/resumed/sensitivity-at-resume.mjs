#!/usr/bin/env node
/* Scratch measurement harness (never committed).
 *
 * Calls the SAME runBacktest / simulateDraft / scoreSeason / gradeRuns as
 * bin/backtest.mjs, but only the 'board' arm, and reports per-seed as well as
 * pooled. Nothing here is imported by shipped code.
 */
import { readFile } from "node:fs/promises";
import { loadLocalGrades } from "./bin/lib/grades.mjs";
import { historicalFixture, simulateDraft, scoreSeason, gradeRuns, ROSTER_SHAPES } from "./js/backtest.js";
import { PLAN_AHEAD } from "./js/value.js";

const history = new URL("./data/historical/2025/", import.meta.url);
const draft = JSON.parse(await readFile(new URL("draft.json", history), "utf8"));
const weeks = await Promise.all(Array.from({ length: 17 }, (_, i) => readFile(
  new URL(`weeks/week-${String(i + 1).padStart(2, "0")}.json`, history), "utf8").then(JSON.parse)));
const fixture = historicalFixture(draft, weeks, await loadLocalGrades(draft.season));


const configs = [
 {teams:10,format:"half_ppr",slots:ROSTER_SHAPES.classic},
 {teams:14,format:"half_ppr",slots:ROSTER_SHAPES.double_flex},
 {teams:12,format:"std",slots:ROSTER_SHAPES.three_wr,opponentStyle:"mixed"},
 {teams:12,format:"ppr",slots:ROSTER_SHAPES.double_flex,opponentStyle:"mixed"},
];
const runs=[];
for(const seed of String(process.argv[3] ?? "17").split(",").map(Number)) for(const config of configs) for(const heroSeat of [1,Math.ceil(config.teams/2),config.teams]) {
 const started=performance.now();
 const simulation=simulateDraft(fixture,{...config,heroSeat,seed,heroStrategy:"board",ahead:Number(process.argv[2])});
 const results=scoreSeason(fixture,simulation,config);
 runs.push({config,heroSeat,seed,points:results[heroSeat-1].total,ms:performance.now()-started});
}
console.log(JSON.stringify(runs,null,2));
