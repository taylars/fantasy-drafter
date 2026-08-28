// Read-only measurement driver. Run against an isolated checkout or copy.
// node scripts/experiments/bench-option-check.mjs /absolute/repo [--sensitivity]
import {readFile,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
const root=process.argv[2] ?? process.cwd(), started=performance.now();
const sensitivity=process.argv.includes('--sensitivity');
const {loadLocalGrades}=await import(pathToFileURL(`${root}/bin/lib/grades.mjs`));
const {historicalFixture,simulateDraft,scoreSeason,gradeRuns,ROSTER_SHAPES}=await import(pathToFileURL(`${root}/js/backtest.js`));
const {PLAN_AHEAD}=await import(pathToFileURL(`${root}/js/value.js`));
const read=async p=>JSON.parse(await readFile(`${root}/data/historical/2025/${p}`,'utf8'));
const draft=await read('draft.json');
const weeks=await Promise.all(Array.from({length:17},(_,i)=>read(`weeks/week-${String(i+1).padStart(2,'0')}.json`)));
const fixture=historicalFixture(draft,weeks,await loadLocalGrades(draft.season));
const runs=[], perSeed=[];
const cases = sensitivity
 ? [
    {label:'classic',slots:ROSTER_SHAPES.classic},
    {label:'three_wr',slots:ROSTER_SHAPES.three_wr},
    {label:'std',format:'std'},
    {label:'ppr',format:'ppr'},
    {label:'mixed',opponentStyle:'mixed'},
   ]
 : Array.from({length:16},(_,i)=>({label:String(i+1),seed:i+1}));
for(const config of cases) {
 const seed=config.seed ?? 17;
 const group=[];
 for(const heroSeat of (sensitivity ? [1,6,12] : Array.from({length:12},(_,i)=>i+1))) {
  const simulation=simulateDraft(fixture,{...config,ahead:PLAN_AHEAD,seed,teams:12,heroSeat,heroStrategy:'board'});
  const results=scoreSeason(fixture,simulation,config);
  for(const r of results) Object.defineProperty(r,'_teams',{value:12});
  group.push({heroSeat,seed,label:config.label,simulation,results});
 }
 runs.push(...group); perSeed.push({label:config.label,seed,grade:gradeRuns(group)});
 console.error(config.label,perSeed.at(-1).grade.averagePoints);
}
await writeFile(`${root}/${sensitivity ? "sensitivity" : "results"}.json`,JSON.stringify({seconds:(performance.now()-started)/1000,...(sensitivity ? {} : {train:gradeRuns(runs.slice(0,96)),holdout:gradeRuns(runs.slice(96))}),perSeed,points:runs.map(r=>({label:r.label,seed:r.seed,seat:r.heroSeat,points:r.results[r.heroSeat-1].total}))},null,2));
