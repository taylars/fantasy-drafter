#!/usr/bin/env node
/* Sweep risk/ceiling exchange rates in one process. */
import { readFile, writeFile } from "node:fs/promises";
import { loadLocalGrades } from "/Users/taylor-larsen/Code/fantasy-drafter/.claude/worktrees/agent-a95db20ef16f7dcaf/bin/lib/grades.mjs";
import { historicalFixture, runBacktest, gradeRuns } from "/Users/taylor-larsen/Code/fantasy-drafter/.claude/worktrees/agent-a95db20ef16f7dcaf/js/backtest.js";
import { configureRisk } from "/Users/taylor-larsen/Code/fantasy-drafter/.claude/worktrees/agent-a95db20ef16f7dcaf/js/value.js";

const root = new URL("file:///Users/taylor-larsen/Code/fantasy-drafter/.claude/worktrees/agent-a95db20ef16f7dcaf/");
const history = new URL("data/historical/2025/", root);
const draft = JSON.parse(await readFile(new URL("draft.json", history), "utf8"));
const weeks = await Promise.all(Array.from({ length: 17 }, (_, i) => readFile(
  new URL(`weeks/week-${String(i + 1).padStart(2, "0")}.json`, history), "utf8").then(JSON.parse)));
const fixture = historicalFixture(draft, weeks, await loadLocalGrades(draft.season));

const seeds = (process.argv.find(a => a.startsWith("--seeds=")) ?? "--seeds=1,2,3")
  .split("=")[1].split(",").map(Number);
// --grid="risk:0.15 risk:0.5 ceiling:1 ..."
const grid = (process.argv.find(a => a.startsWith("--grid=")) ?? "--grid=risk:0").split("=")[1].split(/\s+/);
const perSeed = process.argv.includes("--per-seed");

const line = (g) => `score ${String(g.score).padStart(4)}  points ${g.averagePoints} ±${g.pointsStandardError} (n=${g.samples})`
  + `  finish ${g.averageFinish}  allPlay ${g.allPlayWinRate}%  highs ${g.weeklyHighScoreRate}%`
  + `  playoffs ${g.playoffRate}%  champs ${g.championshipRate}%`;

for (const spec of grid) {
  const config = { risk: 0, ceiling: 0, flatCv: 0 };
  for (const part of spec.split(",")) {
    const [k, v] = part.split(":");
    config[k] = Number(v);
  }
  configureRisk(config);
  const started = Date.now();
  const { board } = runBacktest(fixture, { seeds, strategies: ["board"] });
  await writeFile(`/private/tmp/ceiling-${process.env.CEILING_LABEL}.json`, JSON.stringify(board));
  console.log(`\n[${spec}]  (${((Date.now() - started) / 1000).toFixed(0)}s)`);
  console.log(`  POOLED  ${line(board.grade)}`);
  console.log(`    positional ${Object.entries(board.grade.positionalPoints).map(([p, n]) => `${p} ${n}`).join(" · ")}`);
  if (perSeed) for (const seed of seeds) {
    console.log(`   seed ${String(seed).padStart(2)}  ${line(gradeRuns(board.runs.filter(r => r.seed === seed)))}`);
  }
}
