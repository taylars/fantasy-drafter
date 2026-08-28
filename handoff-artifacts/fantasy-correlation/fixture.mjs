const ROOT = "/Users/taylor-larsen/Code/fantasy-drafter/.claude/worktrees/agent-aa78ed01a26c1c937/";
import { readFile } from "node:fs/promises";
const { loadLocalGrades } = await import(ROOT + "bin/lib/grades.mjs");
export const bt = await import(ROOT + "js/backtest.js");
export const value = await import(ROOT + "js/value.js");
const history = new URL("file://" + ROOT + "data/historical/2025/");
const draft = JSON.parse(await readFile(new URL("draft.json", history), "utf8"));
const weeks = await Promise.all(Array.from({ length: 17 }, (_, i) => readFile(
  new URL(`weeks/week-${String(i + 1).padStart(2, "0")}.json`, history), "utf8").then(JSON.parse)));
export const fixture = bt.historicalFixture(draft, weeks, await loadLocalGrades(draft.season));
