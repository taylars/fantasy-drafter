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

const runs=[],timings={candidate:0,control:0};
for(const heroSeat of [1,6,12]) {
 const options={seed:9,teams:12,heroSeat,heroStrategy:"board",ahead:PLAN_AHEAD};
 let start=performance.now();const simulation=simulateDraft(fixture,options);timings.candidate+=performance.now()-start;
 start=performance.now();controlDraft(fixture,options);timings.control+=performance.now()-start;
 const results=scoreSeason(fixture,simulation,options);runs.push({seed:9,seat:heroSeat,points:results[heroSeat-1].total});
}
const result={timingsMilliseconds:timings,points:runs};
console.log(JSON.stringify(result));await writeFile(new URL("ceiling-runtime.json",import.meta.url),JSON.stringify(result,null,2));
