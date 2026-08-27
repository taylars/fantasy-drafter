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
import { like } from "./fixture.js";
import { adjusted, optionValue } from "../js/value.js";

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

test("bench upside has no independent value below the waiver projection", () => {
  const player = { position: "WR", points: 100, upside: 2, offense: 0,
    position_security: 0, availability: 0.85 };
  const wire = { WR: adjusted({ ...player }) + 1 };
  assert.equal(optionValue({ ...player }, [], [], wire, true), 0);
  assert.ok(optionValue({ ...player, points: 200 }, [], [], wire, true) > 0);
  assert.equal(optionValue({ ...player, points: 200 }, [], [], wire, false), 0);
  assert.equal(optionValue({ ...player, position: "QB", points: 200 }, [], [], {}, true), 0);
});
