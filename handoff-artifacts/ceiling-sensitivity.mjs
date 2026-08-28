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

const started=performance.now(), runs=[], perSeed=[];
for (const [label,extra] of [["classic",{slots:ROSTER_SHAPES.classic}],["three_wr",{slots:ROSTER_SHAPES.three_wr}],["std",{format:"std"}],["ppr",{format:"ppr"}],["mixed",{opponentStyle:"mixed"}]]) {
 const group=[];
 for (const heroSeat of [1,6,12]) {
  const options={seed:17,teams:12,heroSeat,heroStrategy:"board",ahead:PLAN_AHEAD,...extra};
  const simulation=simulateDraft(fixture,options),results=scoreSeason(fixture,simulation,options);
  for(const r of results) Object.defineProperty(r,"_teams",{value:12});
  group.push({label,seed:17,heroSeat,simulation,results});
 }
 runs.push(...group);perSeed.push({label,seed:17,grade:gradeRuns(group)});
 console.log(label,JSON.stringify(perSeed.at(-1).grade));
 await writeFile(new URL("ceiling-sensitivity.json",import.meta.url),JSON.stringify({seconds:(performance.now()-started)/1000,perSeed,points:runs.map(r=>({label:r.label,seed:r.seed,seat:r.heroSeat,points:r.results[r.heroSeat-1].total}))},null,2));
}
