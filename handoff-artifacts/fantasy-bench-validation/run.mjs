import {readFile,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
const root=process.argv[2], started=performance.now();
const {loadLocalGrades}=await import(pathToFileURL(`${root}/bin/lib/grades.mjs`));
const {historicalFixture,simulateDraft,scoreSeason,gradeRuns}=await import(pathToFileURL(`${root}/js/backtest.js`));
const {PLAN_AHEAD}=await import(pathToFileURL(`${root}/js/value.js`));
const read=async p=>JSON.parse(await readFile(`${root}/data/historical/2025/${p}`,'utf8'));
const draft=await read('draft.json');
const weeks=await Promise.all(Array.from({length:17},(_,i)=>read(`weeks/week-${String(i+1).padStart(2,'0')}.json`)));
const fixture=historicalFixture(draft,weeks,await loadLocalGrades(draft.season));
const runs=[], perSeed=[];
for(let seed=1;seed<=16;seed++) {
 const group=[];
 for(let heroSeat=1;heroSeat<=12;heroSeat++) {
  const simulation=simulateDraft(fixture,{ahead:PLAN_AHEAD,seed,teams:12,heroSeat,heroStrategy:'board'});
  const results=scoreSeason(fixture,simulation,{});
  for(const r of results) Object.defineProperty(r,'_teams',{value:12});
  group.push({heroSeat,seed,simulation,results});
 }
 runs.push(...group); perSeed.push({seed,grade:gradeRuns(group)});
 console.error(seed,perSeed.at(-1).grade.averagePoints);
}
await writeFile(`${root}/results.json`,JSON.stringify({seconds:(performance.now()-started)/1000,train:gradeRuns(runs.slice(0,96)),holdout:gradeRuns(runs.slice(96)),perSeed,points:runs.map(r=>({seed:r.seed,seat:r.heroSeat,points:r.results[r.heroSeat-1].total}))},null,2));
