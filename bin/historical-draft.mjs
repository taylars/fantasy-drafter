#!/usr/bin/env node
/* Freeze the draft-time inputs for a season before results are known.
 *
 *     npm run historical:draft -- --season 2026
 *
 * Weekly results are deliberately not written here. They live as independent
 * files under data/historical/<season>/weeks/ as the season progresses.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { SleeperClient, POSITIONS } from "../js/sleeper.js";
import { scoreStats, statLine } from "../js/pool.js";

function value(flag, fallback) {
  const prefix = `--${flag}=`;
  const joined = process.argv.find((arg) => arg.startsWith(prefix));
  if (joined) return joined.slice(prefix.length);
  const i = process.argv.indexOf(`--${flag}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const season = String(value("season", "2026"));
const out = new URL(`../data/historical/${season}/`, import.meta.url);
const gradesFile = new URL("../data/grades.json", import.meta.url);
const scoringSource = new URL("../data/historical/2025/draft.json", import.meta.url);
const { scoring } = JSON.parse(await readFile(scoringSource, "utf8"));
const gradeDocument = JSON.parse(await readFile(gradesFile, "utf8"));
if (String(gradeDocument.season) !== season) {
  throw new Error(`data/grades.json is for ${gradeDocument.season}, not ${season}`);
}

const source = `https://api.sleeper.app/projections/nfl/${season}`;
const records = await new SleeperClient({ timeout: 30_000, retries: 3 }).getProjections(season);
const draftable = records.filter((record) => {
  const position = record.player?.position;
  const adp = record.stats?.adp_half_ppr;
  return record.player_id && POSITIONS.includes(position) && Number.isFinite(adp) && adp < 999;
}).sort((a, b) => a.stats.adp_half_ppr - b.stats.adp_half_ppr).slice(0, 300);

const players = draftable.map((record) => {
  const stats = record.stats;
  const line = statLine(stats);
  return {
    player_id: record.player_id,
    name: `${record.player.first_name ?? ""} ${record.player.last_name ?? ""}`.trim(),
    position: record.player.position,
    team: record.player.team ?? record.team ?? null,
    injury_status: record.player.injury_status ?? null,
    adp: {
      std: stats.adp_std,
      half_ppr: stats.adp_half_ppr,
      ppr: stats.adp_ppr,
      two_qb: stats.adp_2qb,
    },
    projected: Object.fromEntries(Object.entries(scoring).map(([format, settings]) =>
      [format, scoreStats(line, settings)])),
    projection: line,
    grade: gradeDocument.grades[record.player_id] ?? null,
    projection_modified: record.last_modified ?? record.updated_at ?? null,
  };
});

const captured = new Date().toISOString();
const fixture = {
  captured,
  season,
  source,
  grades_source: "data/grades.json",
  grades_captured: captured,
  formats: Object.keys(scoring),
  scoring,
  players,
};

await mkdir(new URL("weeks/", out), { recursive: true });
await writeFile(new URL("draft.json", out), `${JSON.stringify(fixture)}\n`);
console.log(`wrote ${players.length} players (${players.filter((p) => p.grade).length} graded) to ${new URL("draft.json", out).pathname}`);
