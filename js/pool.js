/* Turning Sleeper's projections response into a pool of priced players.
 *
 * This is the seam between Sleeper's shapes and the value formula. Everything
 * downstream of here talks about Players; everything upstream talks about
 * whatever the projections endpoint happens to return this week. Keeping the
 * two apart is what lets value.js be pure arithmetic and lets a shape change
 * be a fix in one file.
 *
 * The pool is every player Sleeper publishes both an ADP and a projected stat
 * line for. A player with an ADP but no stat line is deep bench filler and is
 * left out rather than scored zero, which would rank him below replacement
 * instead of omitting him.
 */

import { SEASON_GAMES, DEFAULT_AVAILABILITY } from "./value.js";

// Sleeper reports "not drafted" as an ADP of 999 rather than a null, so the
// sentinel has to be filtered out by value or the list ends in a thousand
// players who all tie for last.
export const ADP_UNDRAFTED = 999;

// Sleeper publishes ADP once per scoring format. A league reads the one that
// matches its own scoring_type; anything unrecognised falls back to half PPR,
// which is the middle of the three and the least wrong default.
const ADP_COLUMNS = {
  std: "adp_std",
  half_ppr: "adp_half_ppr",
  ppr: "adp_ppr",
  "2qb": "adp_2qb",
  dynasty: "adp_dynasty",
};

export function adpKey(scoringType) {
  return ADP_COLUMNS[scoringType ?? ""] ?? "adp_half_ppr";
}

/* Derive ppr / half_ppr / std from a league's scoring settings.
 *
 * The league object has no scoring_type field — only the draft object does, and
 * a league can be read without one — so it is inferred from the points given
 * for a reception. A 2QB league is not detectable this way and reads as
 * whatever its receptions say, which costs it the `adp_2qb` column. That is
 * what draftFormat below is for: when there is a draft, it has already been
 * told the answer this function has to guess at.
 */
export function scoringType(league) {
  const rec = league.scoring_settings?.rec;
  if (rec == null) return null;
  if (rec >= 1) return "ppr";
  return rec > 0 ? "half_ppr" : "std";
}

/* Which format's ADP a board prices against: the draft's, when there is one.
 *
 * The draft on screen is the authority and the league is only the fallback. A
 * mock started cold belongs to no league and can be standard scoring while the
 * league it was opened under is half PPR, and in that room the standard column
 * is the one every other seat is reading. Pricing against the league there puts
 * a number on the board that matches nothing anyone else can see.
 *
 * `league.scoring_type` sits between the two because Sleeper has never sent it
 * on a league object; it is here for the day that changes, not for today.
 */
export function draftFormat(league, draft) {
  return draft?.scoring_type ?? league.scoring_type ?? scoringType(league);
}

// Points per reception, by format. The three scoring formats differ in this
// one number and in nothing else, which is why a draft's format is applied by
// swapping `rec` on the league's own settings rather than by reading Sleeper's
// precomputed pts_*: a league that docks an interception 2 points where
// Sleeper's preset docks 1 keeps its own answer for every quarterback.
//
// `2qb` and `dynasty` are absent on purpose. Neither is a scoring format — one
// is roster construction, the other is a draft type — so a draft that says
// either says nothing about receptions and the league's own value stands.
const FORMAT_REC = { std: 0, half_ppr: 0.5, ppr: 1 };

/* The scoring a board's points are computed under.
 *
 * The league's settings, with receptions set to whatever the draft on screen
 * is scored at. A standard mock run from a half PPR league is a standard board
 * end to end — the same reason its ADP comes from adp_std — so a receiver's
 * points there should be the points he is worth in that room, not in the
 * league the mock was opened from.
 */
export function scoringFor(league, draft) {
  const scoring = league.scoring_settings ?? {};
  const rec = FORMAT_REC[draftFormat(league, draft)];
  return rec == null || rec === scoring.rec ? scoring : { ...scoring, rec };
}

/* A healthy starting quarterback is unusually durable. Grade notes can still
 * explain why a projection is lower, but historical injuries should not make a
 * current QB1 a projected 13-game player unless the feed says he is presently
 * injured. Backups are deliberately excluded: their low expected games describe
 * role, not durability.
 *
 * Who is a starter comes from the projection itself rather than a depth chart.
 * Sleeper projects pass attempts for 77 quarterbacks and the split is not
 * close — 31 at 300+, 42 under 100, four in between — so the provider's own
 * view of who takes the snaps is both cleaner than `depth_chart_order` and
 * already in the response the board has to fetch anyway.
 */
const HEALTHY_QB_FLOOR_GAMES = 15.0;
const QB_STARTER_PASS_ATT = 300;
const CURRENT_INJURY_STATUSES = new Set([
  "Questionable", "Doubtful", "Out", "IR", "Injured Reserve", "PUP", "Suspended",
]);

/* Turn a projected stat line into points under one league's scoring.
 *
 * Only keys the league actually scores contribute, so a line carrying IDP or
 * return-game keys the league ignores costs nothing. This is why the line is
 * kept whole rather than pre-totalled: the same projection scores differently
 * in two leagues, and Sleeper's own pts_* are generic (their half PPR preset
 * docks an interception 1 point, where a league may say 2).
 */
export function scoreStats(stats, scoring) {
  let total = 0;
  for (const [key, value] of Object.entries(stats)) {
    const multiplier = scoring[key];
    if (typeof multiplier === "number" && typeof value === "number") total += value * multiplier;
  }
  return Math.round(total * 100) / 100;
}

/* The projected stat line alone: the adp_*, pts_* and gp keys are answers to
 * other questions that Sleeper happens to deliver in the same object.
 */
export function statLine(stats) {
  const line = {};
  for (const [key, value] of Object.entries(stats)) {
    if (key === "gp" || key.startsWith("adp_") || key.startsWith("pts_")) continue;
    line[key] = value;
  }
  return line;
}

/* Every draftable player, priced for one league.
 *
 * `grades` is {player_id: {offense, position_security, exp_games, upside}} —
 * the researched context the projections cannot carry. A player without one is
 * still in the pool; he just runs on his position's average availability, which
 * is what `graded` on the row is warning about.
 */
export function buildPool(projections, grades, league, draft = null) {
  const scoring = scoringFor(league, draft);
  const key = adpKey(draftFormat(league, draft));
  const pool = [];

  for (const record of projections) {
    const stats = record.stats;
    const player = record.player;
    if (!record.player_id || !stats || !player) continue;

    const adp = stats[key];
    if (typeof adp !== "number" || adp >= ADP_UNDRAFTED) continue;

    // No stat line is no projection, which is different from a projection of
    // nothing — so he is omitted rather than scored zero.
    const line = statLine(stats);
    if (!Object.keys(line).length) continue;

    const position = player.position;
    const grade = grades[record.player_id] ?? {};
    const graded = grade.exp_games != null;

    let expectedGames = graded
      ? grade.exp_games
      : SEASON_GAMES * (DEFAULT_AVAILABILITY[position] ?? 0.85);

    const healthyStartingQb =
      position === "QB" &&
      (stats.pass_att ?? 0) >= QB_STARTER_PASS_ATT &&
      expectedGames >= 10.0 &&
      !CURRENT_INJURY_STATUSES.has(player.injury_status ?? "");
    if (healthyStartingQb) expectedGames = Math.max(expectedGames, HEALTHY_QB_FLOOR_GAMES);

    pool.push({
      player_id: record.player_id,
      name: `${player.first_name ?? ""} ${player.last_name ?? ""}`.trim(),
      position,
      team: player.team ?? record.team ?? null,
      injury_status: player.injury_status ?? null,
      adp,
      points: scoreStats(line, scoring),
      availability: expectedGames / SEASON_GAMES,
      offense: grade.offense ?? 0,
      position_security: grade.position_security ?? 0,
      upside: grade.upside ?? 0,
      graded,
    });
  }

  pool.sort((a, b) => a.adp - b.adp || a.name.localeCompare(b.name));
  return pool;
}

/* The draft object, flattened to the handful of fields the model reads.
 *
 * Sleeper nests teams/rounds/reversal under `settings` and leaves type, status
 * and draft_order at the top level. value.js should not have to know that, and
 * the board and the CLI should not each have their own idea of it.
 */
export function draftShape(draft) {
  const settings = draft.settings ?? {};
  return {
    draft_id: draft.draft_id,
    league_id: draft.league_id ?? null,
    type: draft.type,
    status: draft.status,
    // Sleeper keeps the draft's scoring format down in metadata, and it is the
    // only place a mock's format is written down at all.
    scoring_type: draft.metadata?.scoring_type ?? null,
    teams: settings.teams,
    rounds: settings.rounds,
    reversal_round: settings.reversal_round ?? 0,
    start_time: draft.start_time ?? null,
    draft_order: draft.draft_order,
    // A mock started from a league records it here even though league_id is
    // null and the league's own /drafts endpoint won't return it.
    source_league_id: draft.metadata?.league_id ?? draft.league_id ?? null,
  };
}

/* Who's gone, who's ours, and which pick is next.
 *
 * A pick with no `picked_by` is an autopick, so it counts as gone rather than
 * as ours — the board can only recognise our own picks by user_id.
 */
export function draftState(picks, userIds) {
  const gone = new Set();
  const ours = new Set();
  for (const pick of picks) {
    if (!pick.player_id) continue;
    gone.add(pick.player_id);
    if (pick.picked_by && userIds.has(pick.picked_by)) ours.add(pick.player_id);
  }
  return { gone, ours, atPick: picks.length + 1 };
}
