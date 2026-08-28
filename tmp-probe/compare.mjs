import { readFile } from "node:fs/promises";
const a = JSON.parse(await readFile(process.argv[2], "utf8"));
const b = JSON.parse(await readFile(process.argv[3], "utf8"));
const key = (r) => `${r.seed}/${r.seat}`;
const map = new Map(a.rows.map((r) => [key(r), r]));
const diffs = [], changed = [];
for (const r of b.rows) {
  const base = map.get(key(r));
  diffs.push(r.total - base.total);
  if (r.picks !== base.picks) changed.push(key(r));
}
const n = diffs.length;
const mean = diffs.reduce((s, d) => s + d, 0) / n;
const sd = Math.sqrt(diffs.reduce((s, d) => s + (d - mean) ** 2, 0) / (n - 1));
const se = sd / Math.sqrt(n);
const bySeed = {};
for (const r of b.rows) {
  (bySeed[r.seed] ??= []).push(r.total - map.get(key(r)).total);
}
console.log(`${process.argv[2]} -> ${process.argv[3]}`);
console.log(`  unpaired: ${a.grade.averagePoints} ±${a.grade.pointsStandardError}  ->  ${b.grade.averagePoints} ±${b.grade.pointsStandardError}`);
console.log(`  PAIRED delta ${mean.toFixed(1)} ±${se.toFixed(1)} (n=${n})   t=${(mean / se).toFixed(2)}`);
console.log(`  drafts that changed at all: ${changed.length}/${n}`);
const nz = diffs.filter((d) => d !== 0);
if (nz.length) {
  const m2 = nz.reduce((s, d) => s + d, 0) / nz.length;
  const sd2 = Math.sqrt(nz.reduce((s, d) => s + (d - m2) ** 2, 0) / Math.max(1, nz.length - 1));
  console.log(`  among ${nz.length} changed-score drafts: delta ${m2.toFixed(1)} ±${(sd2 / Math.sqrt(nz.length)).toFixed(1)}`);
}
console.log(`  per-seed paired delta: ${Object.entries(bySeed).map(([s, d]) => `${s}:${(d.reduce((x, y) => x + y, 0) / d.length).toFixed(0)}`).join("  ")}`);
console.log(`  draft-only seconds ${a.elapsed.toFixed(1)} -> ${b.elapsed.toFixed(1)}`);
