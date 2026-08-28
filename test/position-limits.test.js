/* Positional roster caps, which are a legality rule rather than a preference.
 *
 * A league can cap how many of a position one roster may hold, and Sleeper
 * enforces it by rejecting the pick. So a capped position must leave the board
 * entirely: pricing it down is not enough, because a recommendation you are not
 * allowed to act on is worse than no recommendation. These tests pin down that
 * it disappears from all three places a position can be proposed — the ranked
 * board, the plan search, and the scripted opponents the backtest drafts
 * against — and that the caps are only read when the draft says it enforces
 * them.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { scenario } from "./scenario.js";
import { player } from "./fixture.js";
import { positionLimits, draftShape } from "../js/pool.js";
import { mustFill, planPositions } from "../js/value.js";
import { scriptedChoice } from "../js/draft-policy.js";

// The shape Sleeper actually sends, trimmed to what is read here.
const SLEEPER_SETTINGS = {
  enforce_position_limits: 1, rounds: 15, teams: 12,
  position_limit_qb: 2, position_limit_rb: 4, position_limit_wr: 4,
  position_limit_te: 2, position_limit_k: 2, position_limit_def: 2,
};

test("caps are read off the draft, and only where the draft enforces them", () => {
  assert.deepEqual(positionLimits(SLEEPER_SETTINGS),
    { QB: 2, RB: 4, WR: 4, TE: 2, K: 2, DEF: 2 });

  // The same numbers with the flag off are inert settings the room is not
  // playing under; reading them would invent a constraint.
  assert.deepEqual(positionLimits({ ...SLEEPER_SETTINGS, enforce_position_limits: 0 }), {});
  assert.deepEqual(positionLimits({}), {});
  assert.deepEqual(draftShape({ settings: SLEEPER_SETTINGS }).position_limits,
    positionLimits(SLEEPER_SETTINGS));
});

test("a position at its cap leaves the board and the plan entirely", () => {
  const roster = ["Ja'Marr Chase", "Justin Jefferson"];
  const limits = { WR: 2 };

  const open = scenario({ roster });
  assert.ok(open.ranked.some((row) => row.player.position === "WR"),
    "the fixture should offer receivers when nothing is capping them");

  const capped = scenario({ roster, limits });
  assert.equal(capped.ranked.filter((row) => row.player.position === "WR").length, 0,
    `capped board still offers ${capped.top().join(", ")}`);
  assert.ok(capped.ranked.length > 0, "capping one position must not empty the board");

  // And the plan search agrees: no continuation may spend a pick on a receiver
  // we are not allowed to draft.
  for (const plan of capped.plans()) {
    assert.ok(!plan.sequence.includes("WR"),
      `plan ${plan.sequence.join("-")} spends a pick on a capped position`);
  }
});

test("an uncapped position is untouched by another position's cap", () => {
  const roster = ["Ja'Marr Chase", "Justin Jefferson"];
  const capped = scenario({ roster, limits: { WR: 2 } });
  assert.ok(capped.ranked.some((row) => row.player.position === "RB"),
    "backs should still be on a board that only caps receivers");
  assert.deepEqual(planPositions([{ position: "WR" }, { position: "WR" }], ["QB", "WR", "FLEX"],
    ["RB", "WR"], { WR: 2 }), ["RB"]);
});

test("the endgame never forces the board onto a position it cannot fill", () => {
  // Two kicker slots, one kicker held, and a cap saying that one is all we may
  // have — a league whose settings contradict its own roster. The second slot
  // can never be filled, so the endgame must not spend its last pick trying:
  // forcing the board onto K would leave nothing legal on it at all.
  const roster = [{ position: "K" }];
  const slots = ["QB", "K", "K", "BN"];
  assert.deepEqual([...mustFill(roster, slots, 1)].sort(), ["K", "QB"]);
  assert.deepEqual([...mustFill(roster, slots, 1, { K: 1 })], ["QB"]);
});

test("scripted opponents draft within the caps too", () => {
  const slots = ["QB", "RB", "RB", "WR", "WR", "FLEX", "BN", "BN"];
  const roster = [{ position: "WR" }, { position: "WR" }];
  const available = [
    player({ name: "Capped Carter", position: "WR", adp: 1, points: 300 }),
    player({ name: "Legal Lewis", position: "RB", adp: 40, points: 180 }),
  ];

  // Uncapped, the script takes the far better receiver on ADP alone.
  assert.equal(scriptedChoice(available, roster, slots, { round: 3 }).name, "Capped Carter");
  assert.equal(
    scriptedChoice(available, roster, slots, { round: 3, limits: { WR: 2 } }).name,
    "Legal Lewis");
});
