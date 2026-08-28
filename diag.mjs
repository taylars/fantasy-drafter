/* Diagnostic harness — imports the backtest read-only, never modifies it.
 * Reports per-seed points, roster composition, and replacement starts. */
import { readFile } from "node:fs/promises";
import { loadLocalGrades } from "./bin/lib/grades.mjs";
import { historicalFixture, runBacktest } from "./js/backtest.js";

const history = new URL("./data/historical/2025/", import.meta.url);
const draft = JSON.parse(await readFile(new URL("draft.json", history), "utf8"));
const weeks = await Promise.all(Array.from({ length: 17 }, (_, i) => readFile(
  new URL(`weeks/week-${String(i + 1).padStart(2, "0")}.json`, history), "utf8").then(JSON.parse)));
const fixture = historicalFixture(draft, weeks, await loadLocalGrades(draft.season));

const seedsArg = process.argv.find(a => a.startsWith("--seeds="));
const seeds = seedsArg ? seedsArg.split("=")[1].split(",").map(Number) : [1, 2, 3, 4, 5, 6, 7, 8];
const only = process.argv.find(a => a.startsWith("--strategies="));
const strategies = only ? only.split("=")[1].split(",") : ["board", "adp"];
const results = runBacktest(fixture, { seeds, strategies });

const mean = xs => xs.reduce((a, b) => a + b, 0) / xs.length;
const sem = xs => {
  const m = mean(xs);
  const v = xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(v / xs.length);
};
const r1 = x => Math.round(x * 10) / 10;

for (const [name, { grade, runs }] of Object.entries(results)) {
  const heroes = runs.map(run => ({ seed: run.seed, r: run.results[run.heroSeat - 1] }));
  console.log(`\n=== ${name.toUpperCase()} ===`);
  console.log(`points ${grade.averagePoints} ±${grade.pointsStandardError} (n=${grade.samples})  score ${grade.score}  finish ${grade.averageFinish}  allPlay ${grade.allPlayWinRate}%  playoffs ${grade.playoffRate}%  champs ${grade.championshipRate}%`);
  console.log(`positional ${Object.entries(grade.positionalPoints).map(([p, n]) => `${p} ${n}`).join(" · ")}`);

  const perSeed = seeds.map(seed => {
    const totals = heroes.filter(h => h.seed === seed).map(h => h.r.total);
    return `s${seed} ${r1(mean(totals))}`;
  });
  console.log(`per-seed ${perSeed.join("  ")}`);
  console.log(`seed-mean SE ${r1(sem(seeds.map(seed => mean(heroes.filter(h => h.seed === seed).map(h => h.r.total)))))}`);

  // Roster composition
  const counts = {};
  for (const h of heroes) {
    const by = {};
    for (const p of h.r.roster) by[p.position] = (by[p.position] ?? 0) + 1;
    for (const [pos, n] of Object.entries(by)) (counts[pos] ??= []).push(n);
  }
  console.log(`roster ${Object.entries(counts).sort().map(([p, xs]) => `${p} ${r1(mean(xs))}`).join(" · ")}`);

  // Replacement (waiver fallback) starts and empty slots per season, by position
  const repl = {}, empty = {};
  for (const h of heroes) {
    for (const week of h.r.weeks) for (const row of week.assignments) {
      if (!row.player) empty[row.slot] = (empty[row.slot] ?? 0) + 1;
      else if (row.replacement) repl[row.player.position] = (repl[row.player.position] ?? 0) + 1;
    }
  }
  const n = heroes.length;
  console.log(`replacement starts/season ${Object.entries(repl).sort().map(([p, c]) => `${p} ${r1(c / n)}`).join(" · ")}`);
  console.log(`empty slots/season ${Object.entries(empty).sort().map(([p, c]) => `${p} ${r1(c / n)}`).join(" · ") || "none"}`);
}

// Dump per-run hero totals so variants can be compared paired (same seed+seat).
const dumpArg = process.argv.find(a => a.startsWith("--dump="));
if (dumpArg) {
  const { writeFileSync } = await import("node:fs");
  const out = {};
  for (const [name, { runs }] of Object.entries(results)) {
    out[name] = runs.map(run => ({ seed: run.seed, seat: run.heroSeat,
      total: run.results[run.heroSeat - 1].total }));
  }
  writeFileSync(dumpArg.split("=")[1], JSON.stringify(out));
}
