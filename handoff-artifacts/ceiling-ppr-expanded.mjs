#!/usr/bin/env node
/* Sweep risk/ceiling exchange rates in one process. */
import { readFile, writeFile } from "node:fs/promises";
import { loadLocalGrades } from "/Users/taylor-larsen/Code/fantasy-drafter/.claude/worktrees/agent-a95db20ef16f7dcaf/bin/lib/grades.mjs";
import { historicalFixture, runBacktest, gradeRuns } from "/Users/taylor-larsen/Code/fantasy-drafter/.claude/worktrees/agent-a95db20ef16f7dcaf/js/backtest.js";


const root = new URL("file:///Users/taylor-larsen/Code/fantasy-drafter/.claude/worktrees/agent-a95db20ef16f7dcaf/");
const history = new URL("data/historical/2025/", root);
const draft = JSON.parse(await readFile(new URL("draft.json", history), "utf8"));
const weeks = await Promise.all(Array.from({ length: 17 }, (_, i) => readFile(
  new URL(`weeks/week-${String(i + 1).padStart(2, "0")}.json`, history), "utf8").then(JSON.parse)));
const fixture = historicalFixture(draft, weeks, await loadLocalGrades(draft.season));


import { simulateDraft, scoreSeason, ROSTER_SHAPES } from "../js/backtest.js";
import { PLAN_AHEAD } from "../js/value.js";


import {simulateDraft as controlDraft,scoreSeason as controlScore} from "../../agent-a5d21c2822ff46535/handoff-artifacts/fantasy-bench-validation/bup0/js/backtest.js";
const started=performance.now(), runs=[], controlRuns=[];
for(const seed of [9,10]) {
 for (const heroSeat of Array.from({length:12},(_,i)=>i+1)) {
  const options={seed,teams:12,heroSeat,heroStrategy:"board",ahead:PLAN_AHEAD,format:"ppr"};
  const simulation=simulateDraft(fixture,options),results=scoreSeason(fixture,simulation,options);
  const control=controlDraft(fixture,options),controlResults=controlScore(fixture,control,options);
  for(const r of [...results,...controlResults]) Object.defineProperty(r,"_teams",{value:12});
  runs.push({seed,heroSeat,results});controlRuns.push({seed,heroSeat,results:controlResults});
 }
 const result={seconds:(performance.now()-started)/1000,candidate:gradeRuns(runs),control:gradeRuns(controlRuns),points:runs.map((r,i)=>({seed:r.seed,seat:r.heroSeat,candidate:r.results[r.heroSeat-1].total,control:controlRuns[i].results[r.heroSeat-1].total}))};
 console.log(JSON.stringify(result));
 await writeFile(new URL("ceiling-ppr-expanded.json",import.meta.url),JSON.stringify(result,null,2));
 for(const f of ["../HANDOFF.md","experiment-report.md"]) {
  const p=new URL(f,import.meta.url);await writeFile(p,(await readFile(p,"utf8"))+`\nPPR expanded completed through seed ${seed}: candidate ${result.candidate.averagePoints}, control ${result.control.averagePoints}, n=${runs.length}; paired artifact ceiling-ppr-expanded.json.\n`);
 }
}
