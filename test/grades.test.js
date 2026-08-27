import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { loadGrades, indexedSeasons } from "../js/grades.js";
import { loadLocalGrades } from "../bin/lib/grades.mjs";
import { buildPool } from "../js/pool.js";
import { adjusted } from "../js/value.js";

const root = new URL("../", import.meta.url);
const read = path => JSON.parse(readFileSync(new URL(path, root), "utf8"));
const latest = indexedSeasons(read("data/historical/index.json"))[0];

test("the app loader fetches only the newest season and its grades reach the pricing model", async () => {
  const requests = [];
  const document = await loadGrades({ fetchImpl: async (path, options) => {
    requests.push(path);
    assert.equal(options.cache, "no-store");
    return { ok: true, json: async () => read(path) };
  }});
  assert.deepEqual(requests, ["data/historical/index.json", `data/historical/${latest}/grades.json`]);
  assert.equal(document.season, latest);
  assert.deepEqual(document, await loadLocalGrades());
  const league = { scoring_settings: { rec: 1, rec_yd: 0.1, pass_yd: 0.04 } };
  const projections = Object.entries(document.grades).map(([player_id, grade]) => ({
    player_id,
    player: { first_name: grade.name, last_name: "", position: grade.position, team: grade.team, injury_status: null },
    stats: { adp_ppr: 50, rec: 60, rec_yd: 1000, pass_att: 500, pass_yd: 4000 },
  }));
  const pool = buildPool(projections, document.grades, league);
  assert.equal(pool.length, Object.keys(document.grades).length);
  for (const player of pool) {
    const grade = document.grades[player.player_id];
    assert.equal(player.graded, true);
    assert.equal(player.offense, grade.offense);
    assert.equal(player.position_security, grade.position_security);
    assert.equal(player.upside, grade.upside);
    assert.equal(player.availability, grade.exp_games / 17, player.name);
    assert.equal(adjusted(player), player.points * (1 + 0.025 * grade.offense + 0.02 * grade.position_security + 0.0175 * grade.upside));
  }
});

test("latest selection ignores index ordering and never fills gaps from older seasons", async () => {
  const grade = read(`data/historical/${latest}/grades.json`);
  const id = Object.keys(grade.grades)[0];
  const older = { ...structuredClone(grade), season: "2024" };
  const newest = { season: "2027", grades: {} };
  const requests = [];
  const readJson = async path => {
    requests.push(path);
    return path.endsWith("index.json") ? { seasons: ["2027", "2024", "2026"] }
      : path.includes("2027") ? newest : older;
  };
  const result = await loadGrades({ readJson });
  assert.equal(result.season, "2027");
  assert.equal(result.grades[id], undefined);
  assert.equal(requests.length, 2);
  const pool = buildPool([{player_id: id, player: {position: "RB"}, stats: {adp_half_ppr: 1, rush_yd: 100}}], result.grades, {});
  assert.equal(pool[0].graded, false);
  assert.equal(pool[0].offense, 0);
  assert.equal(pool[0].upside, 0);
});

test("missing or mismatched newest data fails instead of silently falling back", async () => {
  await assert.rejects(loadGrades({ fetchImpl: async path => path.endsWith("index.json")
    ? {ok: true, json: async () => ({seasons: ["2025", "2026"]})}
    : {ok: false, status: 404} }), /404/);
  await assert.rejects(loadGrades({readJson: async path => path.endsWith("index.json")
    ? {seasons: ["2025", "2026"]} : {season: "2025", grades: {}}}), /season mismatch/);
});

test("canonical season index matches disk and no duplicate grade stores remain", () => {
  const directories = readdirSync(new URL("data/historical/", root), {withFileTypes: true})
    .filter(d => d.isDirectory() && /^\d{4}$/.test(d.name)).map(d => d.name).sort();
  assert.deepEqual(indexedSeasons(read("data/historical/index.json")).sort(), directories);
  for (const year of directories) {
    assert.ok(read(`data/historical/${year}/draft.json`).players.every(p => !("grade" in p)));
  }
  assert.ok(!existsSync(new URL("data/grades.json", root)));
  assert.ok(!existsSync(new URL("data/grades", root)) || readdirSync(new URL("data/grades", root)).length === 0);
  const g26 = read("data/historical/2026/grades.json");
  assert.equal(Object.keys(g26.grades).length, 200);
  for (const id of ["7528", "9494", "12476", "12504", "12536"]) assert.ok(g26.grades[id], id);
});
