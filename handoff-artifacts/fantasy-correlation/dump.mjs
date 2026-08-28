import { writeFileSync } from "node:fs";
import { bt, fixture } from "./fixture.mjs";
const out = process.argv[2];
const seeds = (process.argv[3] ?? "1,2,3,4,5,6,7,8").split(",").map(Number);
const rows = [];
const allRuns = [];
for (const seed of seeds) {
  for (let heroSeat = 1; heroSeat <= 12; heroSeat++) {
    const simulation = bt.simulateDraft(fixture, { seed, heroSeat, heroStrategy: "board" });
    const results = bt.scoreSeason(fixture, simulation);
    for (const r of results) Object.defineProperty(r, "_teams", { value: 12 });
    allRuns.push({ heroSeat, seed, simulation, results });
    const me = results[heroSeat - 1];
    rows.push({ seed, seat: heroSeat, total: me.total, allPlay: me.allPlay,
                highs: me.highScores, champ: me.champion ? 1 : 0,
                playoffs: me.playoffs ? 1 : 0, rank: me.rank,
                roster: me.roster.map((p) => `${p.position}:${p.team ?? "--"}:${p.name}`) });
  }
  process.stderr.write(".");
}
process.stderr.write("\n");
const grade = bt.gradeRuns(allRuns);
writeFileSync(out, JSON.stringify({ grade, rows }, null, 1));
console.log(`points ${grade.averagePoints} +-${grade.pointsStandardError} (n=${grade.samples})  score ${grade.score}  finish ${grade.averageFinish}  allPlay ${grade.allPlayWinRate}%  highs ${grade.weeklyHighScoreRate}%  champs ${grade.championshipRate}%`);
