import { readFile } from "node:fs/promises";
import { loadLocalGrades } from "../bin/lib/grades.mjs";
import { historicalFixture, strategyPool, DEFAULT_SLOTS, draftOrder } from "../js/backtest.js";
import { situation, survival, PLAN_AHEAD } from "../js/value.js";

const history = new URL("../data/historical/2025/", import.meta.url);
const draftDoc = JSON.parse(await readFile(new URL("draft.json", history), "utf8"));
const weeks = await Promise.all(Array.from({ length: 17 }, (_, i) => readFile(
  new URL(`weeks/week-${String(i + 1).padStart(2, "0")}.json`, history), "utf8").then(JSON.parse)));
const fixture = historicalFixture(draftDoc, weeks, await loadLocalGrades(draftDoc.season));
const pool = strategyPool(fixture.players, "half_ppr")
  .filter(p => Number.isFinite(p.adp) && Number.isFinite(p.points))
  .sort((a, b) => a.adp - b.adp || a.name.localeCompare(b.name));

const teams = 12, rounds = DEFAULT_SLOTS.length;
const draft_order = {}; for (let s = 0; s < teams; s++) draft_order[`seat-${s + 1}`] = s + 1;
const draft = { teams, rounds, type: "snake", reversal_round: 0, draft_order };

const N = Number(process.argv[2] ?? 12);
const gone = new Set(pool.slice(0, N).map(p => p.player_id));
const atPick = N + 1;
const order = draftOrder({ teams, rounds });
const slot = order[N] + 1;
const sit = situation({ pool, slots: DEFAULT_SLOTS, draft, gone, ours: new Set(), atPick, userIds: new Set([`seat-${slot}`]) });
console.log(`atPick ${atPick} slot ${slot} upcoming ${sit.upcoming.slice(0, PLAN_AHEAD)}`);
const nextPick = sit.upcoming[1];
console.log(`\nsurvival to our next pick ${nextPick}:  sim vs analytic`);
let simSum = 0, anSum = 0;
for (const p of sit.available.slice(0, 40)) {
  const r = sit.chances.byId.get(p.player_id);
  const sim = r ? r[sit.chances.picks.indexOf(nextPick)] : 1;
  const an = survival(p.adp, nextPick);
  simSum += sim; anSum += an;
  console.log(`  ${p.position.padEnd(3)} ${p.name.padEnd(22)} adp ${String(Math.round(p.adp)).padStart(3)}  sim ${sim.toFixed(2)}  analytic ${an.toFixed(2)}`);
}
console.log(`\nexpected survivors among top 40: sim ${simSum.toFixed(1)}  analytic ${anSum.toFixed(1)}  (truth: 40 - ${nextPick - atPick} taken = ${40 - (nextPick - atPick)} at most)`);
