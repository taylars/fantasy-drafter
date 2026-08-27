/* A tier edge is urgent only when waiting crosses a meaningful drop.
 *
 * These cases plant the whole local TE market. They do not ask the formula to
 * recognize a label called "tier": the points create the tier, ADP says which
 * members can survive to our next turn, and the roster says whether we need it.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { scenario } from "./scenario.js";
import { player, pool } from "./fixture.js";

const AT = 29;

function goneBefore(at = AT) {
  return pool().filter((p) => p.adp < at).map((p) => p.player_id);
}

function coreRoster() {
  return [
    player({ name: "Roster Back 1", position: "RB", adp: 2, points: 260, exp_games: 17 }),
    player({ name: "Roster Back 2", position: "RB", adp: 8, points: 250, exp_games: 17 }),
    player({ name: "Roster Receiver 1", position: "WR", adp: 3, points: 250, exp_games: 17 }),
    player({ name: "Roster Receiver 2", position: "WR", adp: 9, points: 240, exp_games: 17 }),
  ];
}

function tier(headPoints, lowerPoints = [165, 164, 163]) {
  return [
    player({ name: "Tier Edge", position: "TE", adp: 31, points: headPoints }),
    ...lowerPoints.map((points, i) => player({
      name: `Later Tight End ${i + 1}`,
      position: "TE",
      adp: [44, 55, 66][i],
      points,
    })),
  ];
}

test("the last player before a real positional cliff is recommended now", () => {
  const tightEnds = tier(230);
  const held = coreRoster();
  const draft = scenario({
    plant: [...tightEnds, ...held],
    roster: held,
    drafted: goneBefore(),
    slot: 5,
    at: AT,
  });

  assert.ok(draft.recommends("Tier Edge"),
    `a 65-point TE drop before pick 44 should be urgent; top three was ${draft.top().join(", ")}`);
  assert.ok(draft.rank("Tier Edge") < draft.rank("Later Tight End 1"));
});

test("a small drop with several similar later options is not a cliff", () => {
  const tightEnds = tier(174, [170, 169, 168]);
  const scarce = player({ name: "Scarce Starter", position: "RB", adp: 31, points: 230 });
  const held = coreRoster();
  const draft = scenario({
    plant: [...tightEnds, scarce, ...held],
    roster: held,
    drafted: goneBefore(),
    slot: 5,
    at: AT,
  });

  assert.ok(draft.rank(scarce) < draft.rank("Tier Edge"),
    `four TE points must not outweigh the scarce starter; top was ${draft.top().join(", ")}`);
  assert.ok(draft.recommends(scarce), `top three was ${draft.top().join(", ")}`);
});

test("a cliff at a position already strongly filled is not forced", () => {
  const tightEnds = tier(230);
  const incumbent = player({
    name: "Incumbent Tight End", position: "TE", adp: 20, points: 235, exp_games: 17,
  });
  const needed = player({ name: "Needed Starter", position: "RB", adp: 31, points: 230 });
  const held = [...coreRoster(), incumbent];
  const draft = scenario({
    plant: [...tightEnds, ...held, needed],
    roster: held,
    drafted: goneBefore(),
    slot: 5,
    at: AT,
  });

  assert.ok(draft.rank(needed) < draft.rank("Tier Edge"),
    `a covered TE slot must not force another TE; top was ${draft.top().join(", ")}`);
  assert.ok(draft.recommends(needed), `top three was ${draft.top().join(", ")}`);
});
