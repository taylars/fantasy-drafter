import { readFile, writeFile } from 'node:fs/promises';
import { loadLocalGrades } from '/Users/taylor-larsen/Code/fantasy-drafter/.claude/worktrees/agent-a740e49193fd91e4e/bin/lib/grades.mjs';
import { historicalFixture, runBacktest, gradeRuns } from '/Users/taylor-larsen/Code/fantasy-drafter/.claude/worktrees/agent-a740e49193fd91e4e/js/backtest.js';
const history='/Users/taylor-larsen/Code/fantasy-drafter/.claude/worktrees/agent-a740e49193fd91e4e/data/historical/2025/';
const draft=JSON.parse(await readFile(history+'draft.json','utf8'));
const weeks=await Promise.all(Array.from({length:17},(_,i)=>readFile(history+`weeks/week-${String(i+1).padStart(2,'0')}.json`,'utf8').then(JSON.parse)));
const fixture=historicalFixture(draft,weeks,await loadLocalGrades(draft.season));
const runs=[]; const perSeed=[];
for(let seed=1;seed<=16;seed++) {
const r=runBacktest(fixture,{seeds:[seed],strategies:['board']}).board;
runs.push(...r.runs); perSeed.push({seed,grade:r.grade});
const out={grade:gradeRuns(runs),perSeed,runs:runs.map(x=>({seed:x.seed,seat:x.heroSeat,total:x.results[x.heroSeat-1].total})),discovery:gradeRuns(runs.filter(x=>x.seed<=8)),heldout:seed>=9?gradeRuns(runs.filter(x=>x.seed>=9)):null};
await writeFile(process.argv[2],JSON.stringify(out,null,2));console.log(seed,r.grade.averagePoints);
}
