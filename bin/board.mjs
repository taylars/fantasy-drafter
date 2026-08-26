#!/usr/bin/env node
/* The draft board on the command line.
 *
 *     node bin/board.mjs --user taylars
 *     node bin/board.mjs --user taylars --league <id> --draft <id>
 *     node bin/board.mjs --user taylars --plan     # take now, or wait a round?
 *     node bin/board.mjs --user taylars --json     # the whole ranked board
 *
 * Same modules the page runs, driven from a terminal instead of a browser. That
 * is the point: an agent grading players needs to see what the formula does
 * with a grade it just wrote, and a second implementation for it to call would
 * be a second implementation to keep honest.
 *
 * Projections are cached under data/cache for six hours, so running this
 * repeatedly costs nothing after the first call.
 */

import { readFile } from "node:fs/promises";
import { SleeperClient } from "../js/sleeper.js";
import { FileCache } from "../js/cache-fs.js";
import { buildPool, draftState, scoringType } from "../js/pool.js";
import { situation, board, plans } from "../js/value.js";

const GRADES = "data/grades.json";

function parseArgs(argv) {
  const args = { top: 15 };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === "--plan") args.plan = true;
    else if (flag === "--json") args.json = true;
    else if (flag.startsWith("--")) args[flag.slice(2)] = argv[++i];
  }
  return args;
}

/* The draft object, flattened to the handful of fields the model reads.
 *
 * Sleeper nests teams/rounds/reversal under `settings` and leaves the rest at
 * the top level; value.js should not have to know that.
 */
function draftShape(draft) {
  const settings = draft.settings ?? {};
  return {
    draft_id: draft.draft_id,
    type: draft.type,
    status: draft.status,
    teams: settings.teams,
    rounds: settings.rounds,
    reversal_round: settings.reversal_round ?? 0,
    draft_order: draft.draft_order,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.user) {
    console.error("usage: node bin/board.mjs --user <sleeper username> [--league id] [--draft id] [--plan] [--json]");
    process.exit(2);
  }

  const sleeper = new SleeperClient({ cache: new FileCache() });
  const { grades, season: gradeSeason } = JSON.parse(await readFile(GRADES, "utf8"));

  const user = await sleeper.getUser(args.user);
  if (!user) { console.error(`no such Sleeper user: ${args.user}`); process.exit(1); }

  const state = await sleeper.getState();
  const season = args.season ?? state.season;
  const leagues = await sleeper.getUserLeagues(user.user_id, season);
  if (!leagues.length) { console.error(`${args.user} is in no ${season} leagues`); process.exit(1); }

  const league = args.league ? leagues.find((l) => l.league_id === args.league) : leagues[0];
  if (!league) { console.error(`no league ${args.league} for ${args.user}`); process.exit(1); }

  const drafts = await sleeper.getLeagueDrafts(league.league_id);
  const raw = args.draft
    ? (drafts.find((d) => d.draft_id === args.draft) ?? await sleeper.getDraft(args.draft))
    : drafts[0];
  if (!raw) { console.error(`no draft for ${league.name}`); process.exit(1); }
  const draft = draftShape(raw);

  const projections = await sleeper.getProjections(season);
  const picks = await sleeper.getDraftPicks(draft.draft_id);

  const pool = buildPool(projections, grades, league);
  const userIds = new Set([user.user_id]);
  const { gone, ours, atPick } = draftState(picks, userIds);
  const sit = situation({ pool, slots: league.roster_positions ?? [], draft, gone, ours, atPick, userIds });

  if (args.json) {
    const { ranked } = board(sit, { limit: Number(args.top) || 250 });
    console.log(JSON.stringify({
      league: league.name, season, at_pick: sit.atPick, upcoming: sit.upcoming,
      roster: sit.roster.map((p) => p.name),
      values: ranked.map((r) => ({
        player_id: r.player.player_id, name: r.player.name, position: r.player.position,
        adp: r.player.adp, value: +r.value.toFixed(1), gain: +r.gain.toFixed(1),
        option: +r.option.toFixed(1), graded: r.player.graded,
      })),
    }, null, 1));
    return;
  }

  console.log(`${league.name} (${league.scoring_type ?? scoringType(league)})`);
  console.log(`  our picks: ${sit.upcoming.slice(0, 6).join(", ")}${sit.upcoming.length > 6 ? " ..." : ""}`);
  console.log(`  roster:    ${sit.roster.map((p) => p.name).join(", ") || "empty"}`);

  if (gradeSeason !== String(season)) {
    console.log(`  warning:   grades are for ${gradeSeason}, this league is ${season}`);
  }

  if (args.plan) {
    const scored = plans(sit);
    if (!scored.length) { console.log("\n  no picks left to plan"); return; }
    const over = scored[0].plan.map(([pick]) => pick).join(", ");
    const best = scored[0].total;
    console.log(`\n  best plan starting with each position, over picks ${over}:`);
    for (const { total, sequence, plan } of scored) {
      const who = plan.map(([, p]) => p.name).join(" -> ");
      const delta = `${total - best >= 0 ? "+" : ""}${(total - best).toFixed(1)}`;
      console.log(`    ${sequence[0].padEnd(4)} ${total.toFixed(1).padStart(8)} `
        + `${delta.padStart(7)}  ${sequence.join("/").padEnd(16)}  ${who}`);
    }
    return;
  }

  const { ranked } = board(sit, { limit: 250 });
  const graded = ranked.filter((r) => r.player.graded).length;
  console.log(`  graded:    ${graded} of ${ranked.length} shown`);
  console.log(`\n  ${"value".padStart(7)} ${"gain".padStart(7)} ${"option".padStart(7)} ${"cost".padStart(7)}  `
    + `${"pos".padEnd(4)} ${"adp".padStart(6)}  player`);
  for (const row of ranked.slice(0, Number(args.top))) {
    console.log(`  ${row.value.toFixed(1).padStart(7)} ${row.gain.toFixed(1).padStart(7)} `
      + `${row.option.toFixed(1).padStart(7)} ${row.cost.toFixed(1).padStart(7)}  `
      + `${row.player.position.padEnd(4)} ${row.player.adp.toFixed(1).padStart(6)}  `
      + `${row.player.name}${row.player.graded ? "" : "?"}`);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
