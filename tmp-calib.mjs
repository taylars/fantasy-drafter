import { readFile } from "node:fs/promises";
import { loadLocalGrades } from "./bin/lib/grades.mjs";
import { historicalFixture, strategyPool } from "./js/backtest.js";
import { survival } from "./js/value.js";
const history = new URL("./data/historical/2025/", import.meta.url);
const draft = JSON.parse(await readFile(new URL("draft.json", history), "utf8"));
const weeks = await Promise.all(Array.from({ length: 17 }, (_, i) => readFile(
  new URL(`weeks/week-${String(i + 1).padStart(2, "0")}.json`, history), "utf8").then(JSON.parse)));
const fixture = historicalFixture(draft, weeks, await loadLocalGrades(draft.season));
const pool = strategyPool(fixture.players, "half_ppr").filter(p => Number.isFinite(p.adp) && Number.isFinite(p.points));
console.log("pool", pool.length);
for (const [a,b] of [[1,13],[13,25],[25,37],[49,61],[97,109],[133,145],[157,169],[169,181]]) {
  const expected = pool.reduce((s,p)=> s + Math.max(0, survival(p.adp,a) - survival(p.adp,b)), 0);
  console.log(`picks ${a}->${b} (window ${b-a}) expected removed ${expected.toFixed(1)}`);
}
