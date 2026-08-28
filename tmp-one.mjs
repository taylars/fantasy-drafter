import { readFile } from "node:fs/promises";
import { loadLocalGrades } from "./bin/lib/grades.mjs";
import { historicalFixture, simulateDraft, scoreSeason } from "./js/backtest.js";
const history = new URL("./data/historical/2025/", import.meta.url);
const draft = JSON.parse(await readFile(new URL("draft.json", history), "utf8"));
const weeks = await Promise.all(Array.from({ length: 17 }, (_, i) => readFile(
  new URL(`weeks/week-${String(i + 1).padStart(2, "0")}.json`, history), "utf8").then(JSON.parse)));
const fixture = historicalFixture(draft, weeks, await loadLocalGrades(draft.season));
const ahead = Number(process.argv[2] ?? 15);
const t = Date.now();
const sim = simulateDraft(fixture, { seed: 1, teams: 12, heroSeat: 4, heroStrategy: "board", ahead });
const ms = Date.now() - t;
const res = scoreSeason(fixture, sim, {});
console.log(`one draft: ${ms}ms total, ${(ms / 15).toFixed(0)}ms per board pick`);
console.log("hero roster:", sim.rosters[3].map((p) => `${p.position} ${p.name}`).join(" | "));
console.log("hero total:", res[3].total.toFixed(1), "rank", res[3].rank);
