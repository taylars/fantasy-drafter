/* What the board should recommend, and what it should not.
 *
 * Each test plants a player the answer is already known for and checks where
 * the ranking puts him. The point is not to pin the current numbers down —
 * they move whenever the formula is tuned, and a test that failed on every
 * tuning would be deleted within a week. It is to pin down the orderings that
 * have to survive the tuning: a strictly better player has to be taken over the
 * man he is better than, and a strictly worse one must not be.
 *
 * Most of those claims are about the shortlist rather than about first place.
 * `recommends` asks whether the board is pointing at a player at all, which is
 * how a recommendation is actually used and is not sensitive to a tiebreak
 * between rows a point apart. `pick` is for the few claims that really are
 * about the top of the board, and this file has one of each.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { scenario } from "./scenario.js";
import { like, player } from "./fixture.js";
import { lineup, gain } from "../js/value.js";

test("a player strictly better than the best on the board is the recommendation", () => {
  const before = scenario();
  const best = before.pick;

  // The same man, ten points better. Same position, same ADP, same grades, so
  // the projection is the only thing that could move him — which is what makes
  // the assertion about the ranking rather than about anything else.
  const ringer = like(best, { name: "Ringer Reynolds", points: best.points + 10 });
  const after = scenario({ plant: [ringer] });

  assert.equal(after.pick.name, "Ringer Reynolds",
    `expected the planted player first, got ${after.top().join(", ")}`);
  assert.ok(after.value(ringer) > before.value(best),
    `planted ${after.value(ringer).toFixed(1)}, the man he beats was ${before.value(best).toFixed(1)}`);
  // And he has not simply displaced the board: the man he was copied from is
  // still there, one place down, rather than having been pushed off it.
  assert.equal(after.rank(best), 2);
});

test("a player strictly worse than the best on the board does not take the top of it", () => {
  const before = scenario();
  const best = before.pick;

  const nearly = like(best, { name: "Nearly Nolan", points: best.points - 10 });
  const after = scenario({ plant: [nearly] });

  assert.equal(after.pick.name, best.name,
    `expected ${best.name} to hold the top, got ${after.top().join(", ")}`);
  // Below the man he was copied from, and not necessarily second: the players
  // in between him and the top are real, and where he lands among them is the
  // formula's business rather than this test's.
  assert.ok(after.rank(nearly) > after.rank(best),
    `planted player ranked ${after.rank(nearly)}, ${best.name} ${after.rank(best)}`);
  assert.ok(after.value(nearly) < after.value(best));
  // Still worth recommending, though — ten points off the best back in the
  // draft is a fine player, and a shortlist that dropped him would be wrong.
  assert.ok(after.recommends(nearly), `top three was ${after.top().join(", ")}`);
});


test("spread preference counts only covered starting slots, including FLEX and wire", () => {
  const starter = player({ name: "Starter", position: "WR", adp: 1, points: 200, exp_games: 17 });
  const reserve = player({ name: "Reserve", position: "WR", adp: 2, points: 150, exp_games: 17 });
  const belowWire = player({ name: "Below Wire", position: "TE", adp: 3, points: 1, exp_games: 17, upside: 2 });
  const base = { WR: 100, TE: 100 };
  assert.equal(lineup([starter, reserve], ["FLEX", "BN"], base), lineup([starter], ["FLEX", "BN"], base));
  assert.ok(gain(reserve, [starter], ["FLEX", "FLEX"], base) > 0);
  assert.equal(gain(belowWire, [starter], ["FLEX", "FLEX"], base), 0);
  const unavailable = like(starter, { availability: 0 });
  assert.equal(lineup([unavailable], ["WR"], base), lineup([], ["WR"], base));
});

test("projection-spread valuation ignores realized outcomes and stale experimental sigma", () => {
  const original = player({ name: "Projection", position: "RB", adp: 1, points: 200, exp_games: 17 });
  const polluted = { ...original, _sigma: 100000, actual: 99999, weekly: [99999] };
  assert.equal(lineup([polluted], ["RB"], {}), lineup([original], ["RB"], {}));
  assert.ok(lineup([like(polluted, { points: 210 })], ["RB"], {}) > lineup([original], ["RB"], {}));
});
