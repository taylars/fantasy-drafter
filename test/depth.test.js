/* Depth lowers urgency. If several interchangeable players can survive until
 * our next turn, spending this pick on the first one has a real opportunity
 * cost even when he is individually good.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { scenario } from "./scenario.js";
import { player, pool } from "./fixture.js";

test("a deep flat position waits behind a similarly productive scarce one", () => {
  const at = 53;
  const drafted = pool().filter((p) => p.adp < at).map((p) => p.player_id);
  const receivers = [
    player({ name: "Flat Receiver 1", position: "WR", adp: 54, points: 190 }),
    player({ name: "Flat Receiver 2", position: "WR", adp: 61, points: 189 }),
    player({ name: "Flat Receiver 3", position: "WR", adp: 67, points: 188 }),
    player({ name: "Flat Receiver 4", position: "WR", adp: 76, points: 187 }),
  ];
  const scarce = player({ name: "Scarce Back", position: "RB", adp: 54, points: 190 });
  const laterBack = player({ name: "Later Back", position: "RB", adp: 76, points: 145 });
  const draft = scenario({
    plant: [...receivers, scarce, laterBack],
    drafted,
    slot: 5,
    at,
  });

  assert.ok(draft.rank(scarce) < draft.rank("Flat Receiver 1"),
    `equal points now should favor the position with the larger wait cost; top was ${draft.top().join(", ")}`);
  assert.ok(draft.recommends(scarce), `top three was ${draft.top().join(", ")}`);
});
