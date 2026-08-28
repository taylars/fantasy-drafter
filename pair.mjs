/* Paired comparison of two diag dumps: same seed+seat, so the draw cancels. */
import { readFileSync } from "node:fs";
const [a, b, strategy = "board"] = process.argv.slice(2);
const A = JSON.parse(readFileSync(a, "utf8"))[strategy];
const B = JSON.parse(readFileSync(b, "utf8"))[strategy];
const key = r => `${r.seed}:${r.seat}`;
const mapA = new Map(A.map(r => [key(r), r.total]));
const diffs = B.map(r => r.total - mapA.get(key(r)));
const mean = xs => xs.reduce((s, x) => s + x, 0) / xs.length;
const m = mean(diffs);
const sd = Math.sqrt(diffs.reduce((s, x) => s + (x - m) ** 2, 0) / (diffs.length - 1));
const se = sd / Math.sqrt(diffs.length);
const r1 = x => Math.round(x * 10) / 10;
console.log(`paired delta ${r1(m)} ±${r1(se)}  (n=${diffs.length}, t=${r1(m / se)})`);
console.log(`better in ${diffs.filter(d => d > 0).length}/${diffs.length} seats`);
const seeds = [...new Set(B.map(r => r.seed))];
console.log(seeds.map(s => {
  const d = B.filter(r => r.seed === s).map(r => r.total - mapA.get(key(r)));
  return `s${s} ${r1(mean(d)) >= 0 ? "+" : ""}${r1(mean(d))}`;
}).join("  "));
