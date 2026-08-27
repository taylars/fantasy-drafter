/* The frozen pool, and the players we plant in it.
 *
 * A recommendation test is an argument about ordering: given this board, this
 * player should come out on top, and this one should not. That argument only
 * holds if the board underneath it is fixed, so the pool comes from
 * test/fixtures/pool.json — a real one, priced under a real league, written
 * down on a day that has passed. bin/fixture.mjs regenerates it, deliberately
 * by hand.
 *
 * Everything a test plants is built here too, so a planted player is always a
 * complete one. A pool row missing `availability` does not throw; it silently
 * covers no weeks and the test fails for a reason that has nothing to do with
 * what it was asking about.
 */

import { readFileSync } from "node:fs";
import { SEASON_GAMES, DEFAULT_AVAILABILITY } from "../js/value.js";

const FIXTURE = new URL("./fixtures/pool.json", import.meta.url);
const fixture = JSON.parse(readFileSync(FIXTURE, "utf8"));

export const { season, league, format, slots, teams, rounds, generated } = fixture;

/* A fresh copy of the pool, every time.
 *
 * value.js memoises each player's context-adjusted projection onto the player
 * object. That is right for a board run and wrong across two of them: a test
 * that alters a player would otherwise be scored on the number the previous
 * test cached. Copying is cheap — five hundred flat objects — and the
 * alternative is a test suite whose results depend on the order it ran in.
 */
export function pool() {
  return structuredClone(fixture.players);
}

/* Ids for planted players, derived from the name rather than counted.
 *
 * A counter would make a player's id depend on how many tests ran before him,
 * which is exactly the kind of cross-test coupling the copying above exists to
 * avoid. The `planted:` prefix keeps them from ever colliding with Sleeper's,
 * which are bare numbers.
 */
function plantedId(name) {
  return `planted:${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}

/* A player to plant in the pool.
 *
 * `name`, `position`, `adp` and `points` are the argument the test is making;
 * everything else defaults to the neutral case — an ungraded player of average
 * durability for his position, with no context correction either way — so that
 * a test only has to say the part it means.
 */
export function player({ name, position, adp, points, exp_games, ...rest }) {
  if (!name || !position || adp == null || points == null) {
    throw new Error("a planted player needs at least name, position, adp and points");
  }
  return {
    player_id: plantedId(name),
    name,
    position,
    team: null,
    injury_status: null,
    adp,
    points,
    availability: exp_games != null
      ? exp_games / SEASON_GAMES
      : (DEFAULT_AVAILABILITY[position] ?? 0.85),
    offense: 0,
    position_security: 0,
    upside: 0,
    graded: true,
    ...rest,
  };
}

/* The same player, with something changed.
 *
 * This is how "just above the best man on the board" gets written without
 * having to restate his projection, his ADP and his grades: copy him, move the
 * one number under test. `_adjusted` is dropped rather than copied — it is
 * value.js's cache of the *original's* projection, and carrying it over would
 * mean the change never took effect.
 */
export function like(original, changes = {}) {
  const { _adjusted, ...clean } = original;
  const copy = { ...clean, ...changes };
  if (changes.name && !changes.player_id) copy.player_id = plantedId(changes.name);
  return copy;
}
