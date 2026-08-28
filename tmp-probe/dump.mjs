import { readFile, writeFile } from "node:fs/promises";
import { loadLocalGrades } from "../bin/lib/grades.mjs";
import { historicalFixture, runBacktest } from "../js/backtest.js";

const history = new URL("../data/historical/2025/", import.meta.url);
const draft = JSON.parse(await readFile(new URL("draft.json", history), "utf8"));
const weeks = await Promise.all(Array.from({ length: 17 }, (_, i) => readFile(
  new URL(`weeks/week-${String(i + 1).padStart(2, "0")}.json`, history), "utf8").then(JSON.parse)));
const fixture = historicalFixture(draft, weeks, await loadLocalGrades(draft.season));

const seeds = (process.argv[3] ?? "1,2,3,4,5,6,7,8").split(",").map(Number);
const started = Date.now();
const results = runBacktest(fixture, { seeds, strategies: ["board"] });
const elapsed = (Date.now() - started) / 1000;

const rows = results.board.runs.map((run) => {
  const hero = run.results[run.heroSeat - 1];
  return { seed: run.seed, seat: run.heroSeat, total: Math.round(hero.total * 10) / 10,
           picks: run.simulation.picks.filter(p => p.seat === run.heroSeat).map(p => p.name).join("|") };
});
await writeFile(process.argv[2], JSON.stringify({ elapsed, grade: results.board.grade, rows }, null, 1));
console.log(`${process.argv[2]}  points ${results.board.grade.averagePoints} ±${results.board.grade.pointsStandardError}  draft-only seconds ${elapsed.toFixed(1)}`);
