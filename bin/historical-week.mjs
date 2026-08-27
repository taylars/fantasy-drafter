#!/usr/bin/env node
/* Capture or replace one completed historical week.
 *
 *     npm run historical:week -- --season 2026 --week 1
 *
 * Reads the season's scoring formats and player IDs from draft.json, then
 * writes only weeks/week-NN.json. It never touches the draft or another week.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { SleeperClient } from "../js/sleeper.js";
import { scoreStats, statLine } from "../js/pool.js";

function required(flag) {
  const prefix = `--${flag}=`;
  const joined = process.argv.find((arg) => arg.startsWith(prefix));
  if (joined) return joined.slice(prefix.length);
  const i = process.argv.indexOf(`--${flag}`);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  throw new Error(`missing --${flag}`);
}

const season = String(required("season"));
const week = Number(required("week"));
if (!Number.isInteger(week) || week < 1 || week > 18) {
  throw new Error(`week must be an integer from 1 through 18, got ${week}`);
}

const root = new URL(`../data/historical/${season}/`, import.meta.url);
const draft = JSON.parse(await readFile(new URL("draft.json", root), "utf8"));
if (String(draft.season) !== season) throw new Error(`draft.json is for ${draft.season}, not ${season}`);

const source = `https://api.sleeper.app/v1/stats/nfl/regular/${season}/${week}`;
const stats = await new SleeperClient({ timeout: 30_000, retries: 3 })
  .get(`/stats/nfl/regular/${season}/${week}`);
if (!stats || !Object.keys(stats).length) throw new Error(`Sleeper returned no stats for ${season} week ${week}`);

const points = {};
for (const player of draft.players) {
  const line = stats[player.player_id] ? statLine(stats[player.player_id]) : null;
  points[player.player_id] = Object.fromEntries(Object.entries(draft.scoring).map(([format, scoring]) =>
    [format, line ? scoreStats(line, scoring) : 0]));
}

const fixture = {
  captured: new Date().toISOString(),
  season,
  week,
  source,
  points,
};
const weeks = new URL("weeks/", root);
await mkdir(weeks, { recursive: true });
const out = new URL(`week-${String(week).padStart(2, "0")}.json`, weeks);
await writeFile(out, `${JSON.stringify(fixture)}\n`);
console.log(`wrote ${Object.keys(points).length} players to ${out.pathname}`);
