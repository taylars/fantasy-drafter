#!/usr/bin/env node
/* Capture one immutable historical season for the draft backtest.
 *
 * This is deliberately manual. Historical inputs should never change because
 * a test happened to run on another day. Run it once, review the generated
 * metadata and player count, and commit the result.
 */

import { writeFile } from "node:fs/promises";
import { SleeperClient, POSITIONS } from "../js/sleeper.js";
import { buildPool, scoreStats, statLine } from "../js/pool.js";

const SEASON = "2025";
const WEEKS = 17;
const OUT = new URL("../test/fixtures/backtest-2025.json", import.meta.url);
const PROJECTIONS = `https://api.sleeper.app/projections/nfl/${SEASON}`;
const STATS = `https://api.sleeper.app/v1/stats/nfl/regular/${SEASON}/{week}`;

// Sleeper's ordinary half-PPR preset, made explicit so both projections and
// actuals are scored by this repository rather than by a precomputed pts key.
const baseScoring = {
  pass_yd: 0.04, pass_td: 4, pass_int: -2, pass_2pt: 2,
  rush_yd: 0.1, rush_td: 6, rush_2pt: 2,
  rec_yd: 0.1, rec_td: 6, rec_2pt: 2,
  fum_lost: -2,
  xpm: 1, xpmiss: -1,
  fgm_0_19: 3, fgm_20_29: 3, fgm_30_39: 3, fgm_40_49: 4, fgm_50p: 5,
  fgmiss: -1,
  sack: 1, int: 2, fum_rec: 2, blk_kick: 2, safe: 2,
  def_td: 6, def_st_td: 6, st_td: 6,
  pts_allow_0: 5, pts_allow_1_6: 4, pts_allow_7_13: 3,
  pts_allow_14_20: 1, pts_allow_21_27: 0,
  pts_allow_28_34: -1, pts_allow_35p: -4,
};
const formats = {
  std: { ...baseScoring, rec: 0 },
  half_ppr: { ...baseScoring, rec: 0.5 },
  ppr: { ...baseScoring, rec: 1 },
};

const league = { scoring_settings: formats.half_ppr };
const draft = { scoring_type: "half_ppr" };
const sleeper = new SleeperClient({ timeout: 30_000, retries: 3 });
const projections = await sleeper.getProjections(SEASON);
const pool = buildPool(projections, {}, league, draft)
  .filter((p) => POSITIONS.includes(p.position))
  .slice(0, 300);

const weeklyRaw = await Promise.all(Array.from({ length: WEEKS }, (_, i) =>
  sleeper.get(`/stats/nfl/regular/${SEASON}/${i + 1}`)));

const weekly = {};
for (const player of pool) {
  weekly[player.player_id] = Object.fromEntries(Object.entries(formats).map(([format, scoring]) => [
    format,
    weeklyRaw.map((week) => {
      const stats = week?.[player.player_id];
      return stats ? scoreStats(statLine(stats), scoring) : 0;
    }),
  ]));
}

const projectionRecords = new Map(projections.map((r) => [r.player_id, r]));
const players = pool.map((p) => {
  const record = projectionRecords.get(p.player_id);
  const line = statLine(record.stats);
  return {
    player_id: p.player_id,
    name: p.name,
    position: p.position,
    team: p.team,
    adp: {
      std: record.stats.adp_std,
      half_ppr: record.stats.adp_half_ppr,
      ppr: record.stats.adp_ppr,
    },
    projected: Object.fromEntries(Object.entries(formats).map(([format, scoring]) =>
      [format, scoreStats(line, scoring)])),
    actual: weekly[p.player_id],
    projection_modified: record?.last_modified ?? record?.updated_at ?? null,
  };
});

const fixture = {
  generated: new Date().toISOString(),
  season: SEASON,
  weeks: WEEKS,
  caveat: "Sleeper archived 2025 projections fetched after the season; modification timestamps are retained because this is not a provable August snapshot.",
  sources: { projections: PROJECTIONS, weekly_stats: STATS },
  format: "half_ppr",
  scoring: formats,
  players,
};

await writeFile(OUT, `${JSON.stringify(fixture)}\n`);
console.log(`wrote ${players.length} players × ${WEEKS} weeks to ${OUT.pathname}`);
