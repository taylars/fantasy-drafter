/* A draft situation to make an assertion about.
 *
 * The board is a function of more than a pool: where we sit, what has already
 * gone, and what we are holding all change what it recommends, and most of the
 * interesting claims about a recommendation are claims about one of those. So a
 * scenario is the whole situation in one object literal —
 *
 *   const draft = scenario({
 *     roster: ["Jahmyr Gibbs", "Ja'Marr Chase"],
 *     drafted: ["Bijan Robinson"],
 *     plant: [player({ name: "...", position: "TE", adp: 40, points: 210 })],
 *   });
 *   assert.equal(draft.pick.name, "...");
 *
 * — and the pick, the ranking and the plans all come off it. Nothing here
 * fetches: the pool is the frozen fixture and the draft is synthesised, so a
 * scenario is the same in a year as it is today.
 */

import { situation, board, plans, ourPicks } from "../js/value.js";
import { pool, slots, teams, rounds } from "./fixture.js";

const US = "us";

/* A plain snake draft with us in one seat.
 *
 * Synthesised rather than snapshotted. A real draft's order is a map of other
 * people's account ids, which tells a reader nothing and would have to be
 * anonymised anyway; what a test actually cares about is the seat, because the
 * seat is what decides how long the wait is until our next pick.
 */
function draftOf(slot, type) {
  const draft_order = { [US]: slot };
  for (let s = 1; s <= teams; s++) if (s !== slot) draft_order[`team-${s}`] = s;
  return { teams, rounds, type, reversal_round: 0, draft_order };
}

/* Find a player in the pool, by name, by id, or by handing over the object.
 *
 * Names are how a test wants to talk about players and ids are how the model
 * does, so this is the seam. It throws rather than skipping: a scenario that
 * quietly drafted nobody would still produce a board, and the assertion against
 * it would then fail somewhere a long way from the typo that caused it.
 *
 * A player object is looked up too, not trusted. Naming a planted man on the
 * roster without also planting him would otherwise put him in `ours` and not in
 * the pool, and the roster the board priced against would silently be one
 * player short of the one the test wrote down.
 */
function resolve(who, index) {
  const key = typeof who === "object" && who !== null ? who.player_id : who;
  const found = index.get(key);
  if (!found) {
    throw new Error(typeof who === "object" && who !== null
      ? `${who.name} is not in the pool — plant him before naming him`
      : `no player named ${JSON.stringify(who)} in the fixture pool`);
  }
  if (found.length > 1) {
    throw new Error(`${found.length} players named ${JSON.stringify(who)}; use a player_id`);
  }
  return found[0];
}

/* The board, at a moment in a draft.
 *
 * `plant` adds players to the pool; `roster` is what we hold; `drafted` is what
 * everyone else has taken. Both roster and drafted may name planted players, so
 * a test can plant a man and then have him go two picks before ours.
 *
 * `at` is the pick we are on. Left out, it is our next pick after everything
 * named has come off the board — which is the situation a test almost always
 * means, and which stays right when a player is added to the setup later.
 */
export function scenario({
  plant = [], roster = [], drafted = [], slot = 1, at = null, type = "snake",
  limit = 200, ahead,
} = {}) {
  const players = [...pool(), ...plant];

  const index = new Map();
  for (const p of players) {
    if (!index.has(p.name)) index.set(p.name, []);
    index.get(p.name).push(p);
    index.set(p.player_id, [p]);
  }

  const mine = roster.map((who) => resolve(who, index));
  const theirs = drafted.map((who) => resolve(who, index));
  const ours = new Set(mine.map((p) => p.player_id));
  const gone = new Set([...ours, ...theirs.map((p) => p.player_id)]);

  const draft = draftOf(slot, type);
  const userIds = new Set([US]);
  const picks = ourPicks(draft, userIds);
  const atPick = at ?? picks.find((p) => p > gone.size) ?? gone.size + 1;

  const sit = situation({ pool: players, slots, draft, gone, ours, atPick, userIds });
  const { ranked } = board(sit, ahead === undefined ? { limit } : { limit, ahead });
  const rows = new Map(ranked.map((row) => [row.player.player_id, row]));

  return {
    sit,
    ranked,
    atPick,
    /* Who the board says to take. The recommendation is the top of the same
     * ranking the page shows, not a second calculation. */
    get pick() { return ranked[0].player; },
    /* The ranked row for a player: value, gain, option, cost. Null when he is
     * off the board entirely — gone, or at a position the plan has closed. */
    row(who) { return rows.get(resolve(who, index).player_id) ?? null; },
    /* Where a player finished, counting from 1, or null if he is not ranked. */
    rank(who) {
      const id = resolve(who, index).player_id;
      const i = ranked.findIndex((row) => row.player.player_id === id);
      return i < 0 ? null : i + 1;
    },
    /* What he is worth to us here, in season points against the best line
     * available. Null when he is not on the board. */
    value(who) { return this.row(who)?.value ?? null; },
    /* The top of the board, for the message on a failed assertion. */
    top(n = 5) {
      return ranked.slice(0, n).map((row) =>
        `${row.player.name} (${row.player.position}, ${row.value.toFixed(1)})`);
    },
    /* The plan search, best plan per starting position. */
    plans(options) { return plans(sit, options); },
  };
}
