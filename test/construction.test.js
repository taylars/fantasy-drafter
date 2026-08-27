/* Bench optionality belongs to the player, not to whether an unrelated final
 * starter has been selected. A high-upside reserve can be the right pick while
 * a flat onesie position remains open, without receiving starter credit.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { scenario } from "./scenario.js";
import { player, pool } from "./fixture.js";

function roster({ includeTE }) {
  const players = [
    player({ name: "Roster QB", position: "QB", adp: 1, points: 330, exp_games: 17 }),
    player({ name: "Roster RB 1", position: "RB", adp: 2, points: 250, exp_games: 17 }),
    player({ name: "Roster RB 2", position: "RB", adp: 3, points: 240, exp_games: 17 }),
    player({ name: "Roster RB 3", position: "RB", adp: 3.5, points: 230, exp_games: 17 }),
    player({ name: "Roster WR 1", position: "WR", adp: 4, points: 230, exp_games: 17 }),
    player({ name: "Roster WR 2", position: "WR", adp: 5, points: 220, exp_games: 17 }),
    player({ name: "Roster Flex 1", position: "WR", adp: 6, points: 210, exp_games: 17 }),
    player({ name: "Roster Flex 2", position: "WR", adp: 7, points: 200, exp_games: 17 }),
    player({ name: "Roster K", position: "K", adp: 9, points: 110, exp_games: 17 }),
    player({ name: "Roster DEF", position: "DEF", adp: 10, points: 100, exp_games: 17 }),
  ];
  if (includeTE) players.push(
    player({ name: "Roster TE", position: "TE", adp: 8, points: 190, exp_games: 17 }));
  return players;
}

function benchCandidates() {
  // Equal adjusted projections: 155 / 1.035 with +2 upside equals 155 with
  // neutral upside. Any difference between them is therefore bench option,
  // not mean lineup production.
  return [
    player({ name: "Upside Reserve", position: "RB", adp: 100, points: 155 / 1.035, upside: 2 }),
    player({ name: "Flat Reserve", position: "RB", adp: 100, points: 155, upside: 0 }),
  ];
}

function draftWith(includeTE) {
  const held = roster({ includeTE });
  const candidates = benchCandidates();
  const planted = [...held, ...candidates];
  const plantedIds = new Set(planted.map((p) => p.player_id));
  const drafted = pool()
    .filter((p) => p.adp < 100 && !plantedIds.has(p.player_id))
    .map((p) => p.player_id);
  return {
    candidates,
    draft: scenario({ plant: planted, roster: held, drafted, slot: 5, at: 100 }),
  };
}

test("bench upside is valuable after the starting lineup is filled", () => {
  const { candidates: [upside, flat], draft } = draftWith(true);

  assert.ok(draft.rank(upside) < draft.rank(flat),
    `upside reserve ranked ${draft.rank(upside)}, flat reserve ${draft.rank(flat)}`);
  assert.ok(draft.row(upside).option > draft.row(flat).option);
});

test("bench upside remains valuable while an unrelated starter slot is open", () => {
  const { candidates: [upside, flat], draft } = draftWith(false);

  assert.equal(draft.row(upside).gain, draft.row(flat).gain,
    "the reserves must have equal lineup value so this remains a bench-option test");
  assert.ok(draft.rank(upside) < draft.rank(flat),
    `upside reserve ranked ${draft.rank(upside)}, flat reserve ${draft.rank(flat)}`);
  assert.ok(draft.row(upside).option > draft.row(flat).option,
    "an open TE slot must not erase the optionality of an RB who would sit on the bench");
});
