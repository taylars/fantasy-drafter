#!/usr/bin/env node
/* The researched grades: what still needs one, and building the file the board ships.
 *
 *     node bin/grades.mjs queue                 # top 200, batches of 25
 *     node bin/grades.mjs queue --top 120 --batch 20 --regrade
 *     node bin/grades.mjs build                 # graded-*.json -> data/grades.json
 *     node bin/grades.mjs build --check         # validate without writing
 *
 * Grades are the one thing the board cannot fetch. No Sleeper endpoint says how
 * good an offense is, how secure a role is, how many games a player will
 * actually manage, or how much room sits above his projection — so they are
 * researched by hand (see .claude/skills/grade-players) and shipped as a static
 * file the page downloads with everything else.
 *
 * The loop is: `queue` says who is worth researching, the skill writes
 * data/grades/graded-NN.json, and `build` validates every batch and merges them
 * into data/grades.json. The graded-*.json files are the source of truth;
 * data/grades.json is derived from them and can be rebuilt at any time.
 */

import { readFile, writeFile, mkdir, readdir, unlink } from "node:fs/promises";
import path from "node:path";
import { SleeperClient, POSITIONS } from "../js/sleeper.js";
import { FileCache } from "../js/cache-fs.js";
import { adpKey } from "../js/pool.js";

const GRADES_DIR = "data/grades";
const GRADES_FILE = "data/grades.json";

// The two positions worth no research: they can be refilled off waivers every
// week, so the gap between the last starter and the wire is ~0 points. No
// amount of context changes that.
const SKIP_POSITIONS = new Set(["K", "DEF"]);

// Every ADP format a league might rank on. A player who goes early in any of
// them is worth researching, since the grades are shared across all leagues.
const ADP_KEYS = ["adp_half_ppr", "adp_ppr", "adp_std", "adp_2qb"];

// Mirrors the ranges the grades are defined on. A bad grade is reported against
// its player and file rather than silently shipped.
const RANGES = {
  offense: [-2, 2], position_security: [-2, 2], upside: [0, 3], exp_games: [0, 17],
};
const REQUIRED = ["offense", "position_security", "exp_games", "upside"];

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === "--regrade") args.regrade = true;
    else if (flag === "--check") args.check = true;
    else if (flag.startsWith("--")) args[flag.slice(2)] = argv[++i];
    else args._.push(flag);
  }
  return args;
}

const client = () => new SleeperClient({ cache: new FileCache() });

async function season(sleeper, given) {
  return given ?? (await sleeper.getState()).season;
}

async function readGrades() {
  try {
    return JSON.parse(await readFile(GRADES_FILE, "utf8"));
  } catch {
    return { season: null, grades: {} };
  }
}

async function gradedFiles(named) {
  if (named.length) return named;
  const all = await readdir(GRADES_DIR).catch(() => []);
  return all.filter((f) => /^graded-.*\.json$/.test(f)).sort().map((f) => path.join(GRADES_DIR, f));
}

/* ------------------------------------------------------------------ queue */

/* The top players by ADP that still need a grade.
 *
 * Two filters. Only the top players matter — below them the replacement
 * baseline has flattened the differences to under a point, so a grade cannot
 * change a decision. And kickers and defenses are skipped outright.
 *
 * The full player file is fetched here, and only here: `age` and
 * `depth_chart_order` live nowhere else, nothing on the board reads them, and a
 * person about to spend an hour on a player wants both in front of them.
 */
async function queue(args) {
  const sleeper = client();
  const year = await season(sleeper, args.season);
  const top = Number(args.top) || 200;
  const batchSize = Number(args.batch) || 25;

  const [projections, players, existing] = await Promise.all([
    sleeper.getProjections(year),
    sleeper.getAllPlayers(),
    readGrades(),
  ]);

  const graded = new Set(args.regrade ? [] : Object.keys(existing.grades ?? {}));
  const candidates = [];

  for (const record of projections) {
    const stats = record.stats;
    if (!stats || !record.player) continue;
    const position = record.player.position;
    if (SKIP_POSITIONS.has(position)) continue;
    if (graded.has(record.player_id)) continue;

    // Best ADP across every format in play, so a player who goes early in any
    // of them is researched.
    const adp = Math.min(...ADP_KEYS.map((k) => stats[k] ?? 999));
    if (adp >= 999) continue;

    const full = players[record.player_id] ?? {};
    candidates.push({
      player_id: record.player_id,
      full_name: `${record.player.first_name ?? ""} ${record.player.last_name ?? ""}`.trim(),
      position,
      team: record.player.team ?? record.team ?? null,
      age: full.age ?? null,
      years_exp: record.player.years_exp ?? full.years_exp ?? null,
      injury_status: record.player.injury_status ?? null,
      depth_chart_order: full.depth_chart_order ?? null,
      adp: Math.round(adp * 10) / 10,
    });
  }

  candidates.sort((a, b) => a.adp - b.adp);
  const wanted = candidates.slice(0, top);

  if (!wanted.length) {
    console.log("nothing to grade — every player in range already has a grade "
      + "(use --regrade to redo them)");
    return;
  }

  await mkdir(GRADES_DIR, { recursive: true });
  // The queue is a whole answer to "what needs grading", not a set of
  // independent files: a stale batch left behind is a batch someone researches
  // for no reason.
  for (const old of await readdir(GRADES_DIR)) {
    if (/^queue-.*\.json$/.test(old)) await unlink(path.join(GRADES_DIR, old));
  }

  const batches = [];
  for (let i = 0; i < wanted.length; i += batchSize) batches.push(wanted.slice(i, i + batchSize));

  for (const [index, batch] of batches.entries()) {
    const n = String(index + 1).padStart(2, "0");
    const file = path.join(GRADES_DIR, `queue-${n}.json`);
    await writeFile(file, JSON.stringify({ season: year, batch: index + 1, players: batch }, null, 2) + "\n");
    console.log(`  ${file}  ${batch.length} players, adp ${batch[0].adp.toFixed(0)}-${batch.at(-1).adp.toFixed(0)}`);
  }
  console.log(`${wanted.length} player(s) to grade in ${batches.length} batch(es)`);
}

/* ------------------------------------------------------------------ build */

/* Everything wrong with one graded entry, so a batch reports in one pass. */
function problems(entry) {
  const found = [];
  for (const field of REQUIRED) {
    const value = entry[field];
    if (value == null) { found.push(`missing ${field}`); continue; }
    if (typeof value !== "number") { found.push(`${field} is not a number`); continue; }
    const [low, high] = RANGES[field];
    if (value < low || value > high) found.push(`${field}=${value} outside ${low}..${high}`);
  }
  if (!entry.sources?.length) found.push("no sources — a grade nobody can check isn't worth storing");
  if (!entry.note) found.push("no note");
  return found;
}

/* Validate every batch and merge them into the file the board ships.
 *
 * A file is rejected whole if any row in it is malformed: a batch is a unit of
 * research, and a half-loaded one is harder to reason about than a rejected
 * one. Everything else still merges, so one bad batch is re-run on its own.
 */
async function build(args) {
  const files = await gradedFiles(args._);
  if (!files.length) {
    console.error(`no graded files — expected ${GRADES_DIR}/graded-*.json `
      + "(run `node bin/grades.mjs queue`, then the grade-players skill)");
    process.exit(1);
  }

  const sleeper = client();
  const projections = await sleeper.getProjections(await season(sleeper, args.season));
  const known = new Map();
  for (const record of projections) {
    if (!record.player) continue;
    known.set(record.player_id, {
      name: `${record.player.first_name ?? ""} ${record.player.last_name ?? ""}`.trim(),
      position: record.player.position,
      team: record.player.team ?? record.team ?? null,
    });
  }

  const grades = {};
  let seasonSeen = null;
  let rejected = 0;

  for (const file of files) {
    let batch;
    try {
      batch = JSON.parse(await readFile(file, "utf8"));
    } catch (err) {
      console.error(`  ${file}: not valid json — ${err.message}`);
      rejected++;
      continue;
    }
    if (!batch.season) { console.error(`  ${file}: no season in the file`); rejected++; continue; }
    if (seasonSeen && batch.season !== seasonSeen) {
      console.error(`  ${file}: season ${batch.season}, but ${seasonSeen} elsewhere`);
      rejected++;
      continue;
    }

    const errors = [];
    const rows = [];
    for (const entry of batch.players ?? []) {
      const who = entry.name || entry.player_id || "?";
      const player = known.get(entry.player_id);
      if (!entry.player_id) { errors.push(`${who}: no player_id`); continue; }
      if (!player) { errors.push(`${who}: no player ${entry.player_id} in the projections`); continue; }
      for (const bad of problems(entry)) errors.push(`${who}: ${bad}`);
      rows.push([entry.player_id, {
        name: player.name, position: player.position, team: player.team,
        offense: entry.offense, position_security: entry.position_security,
        exp_games: entry.exp_games, upside: entry.upside,
        note: entry.note, sources: entry.sources,
        graded_at: entry.graded_at ?? new Date().toISOString().slice(0, 19) + "+00:00",
      }]);
    }

    if (errors.length) {
      console.error(`  ${file}: rejected`);
      for (const e of errors) console.error(`    ${e}`);
      rejected++;
      continue;
    }
    seasonSeen = batch.season;
    for (const [id, row] of rows) grades[id] = row;
    console.log(`  ${file}: ${rows.length} grade(s)${args.check ? " (check only)" : ""}`);
  }

  const total = Object.keys(grades).length;
  if (rejected) {
    console.error(`\n${rejected} file(s) rejected — nothing written`);
    process.exit(1);
  }
  if (args.check) {
    console.log(`\n${total} grade(s) across ${files.length} file(s); nothing written`);
    return;
  }

  // Sorted by position then name, so a diff of this file reads like a change to
  // the research rather than a reshuffle of json.
  const ordered = Object.fromEntries(
    Object.entries(grades).sort(([, a], [, b]) =>
      (a.position ?? "").localeCompare(b.position ?? "") || (a.name ?? "").localeCompare(b.name ?? "")));

  await writeFile(GRADES_FILE, JSON.stringify({ season: seasonSeen, grades: ordered }, null, 1) + "\n");
  console.log(`\n${total} grade(s) for ${seasonSeen} -> ${GRADES_FILE}`);
}

const args = parseArgs(process.argv.slice(2));
const command = args._.shift();

if (command === "queue") await queue(args);
else if (command === "build") await build(args);
else {
  console.error("usage: node bin/grades.mjs queue [--top 200] [--batch 25] [--regrade]");
  console.error("       node bin/grades.mjs build [--check] [files...]");
  process.exit(2);
}
