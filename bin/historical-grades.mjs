#!/usr/bin/env node
import { readFile, readdir, writeFile } from "node:fs/promises";

if (process.argv.includes("--help")) {
  console.log("Usage: node bin/historical-grades.mjs [--check]\nBuild 2025 grades, or validate metadata without writing.");
  process.exit(0);
}
if (process.argv.slice(2).some((arg) => arg !== "--check")) {
  console.error("Unknown argument; use --help");
  process.exit(2);
}

const season = "2025";
const cutoff = "2025-08-29T23:59:59";
const draftPath = `data/historical/${season}/draft.json`;
const gradesPath = `data/historical/${season}/grades`;
const checkOnly = process.argv.includes("--check");
const teamDocument = JSON.parse(await readFile(`${gradesPath}/team-offense.json`, "utf8"));
const teamOffense = new Map(teamDocument.ranked_teams.map((team, i) =>
  [team, i < 3 ? 2 : i < 10 ? 1 : i < 22 ? 0 : i < 29 ? -1 : -2]));
if (teamOffense.size !== 32 || teamDocument.ranked_teams.length !== 32 ||
    teamDocument.season !== season || teamDocument.cutoff !== cutoff)
  throw new Error("Invalid historical team offense document");

function validSource(source) {
  // Compare the source's local calendar date; the explicit cutoff is before Aug 30.
  // This is metadata validation, not proof that a webpage is immutable.
  return typeof source?.url === "string" && /^https:\/\//.test(source.url) &&
    typeof source.title === "string" && source.title.length > 0 &&
    typeof source.published_at === "string" &&
    /^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(source.published_at) &&
    Number.isFinite(Date.parse(source.published_at)) &&
    source.published_at.slice(0, 10) <= "2025-08-29" &&
    (!source.updated_at || (Number.isFinite(Date.parse(source.updated_at)) &&
      source.updated_at.slice(0, 10) <= "2025-08-29"));
}
if (!validSource(teamDocument.source)) throw new Error("Invalid offense source date");

const draft = JSON.parse(await readFile(draftPath, "utf8"));
const wanted = draft.players
  .filter((p) => !["K", "DEF"].includes(p.position))
  .map((p) => ({ ...p, best_adp: Math.min(p.adp.std, p.adp.half_ppr, p.adp.ppr) }))
  .sort((a, b) => a.best_adp - b.best_adp)
  .slice(0, 200);
const wantedIds = new Set(wanted.map((p) => p.player_id));
const positions = new Map(wanted.map((p) => [p.player_id, p.position]));

const files = (await readdir(gradesPath)).filter((f) => /^graded-\d+\.json$/.test(f)).sort();
const grades = new Map();
const errors = [];
for (const file of files) {
  const batch = JSON.parse(await readFile(`${gradesPath}/${file}`, "utf8"));
  if (String(batch.season) !== season) errors.push(`${file}: season must be ${season}`);
  if (batch.cutoff !== cutoff) errors.push(`${file}: cutoff must be ${cutoff}`);
  for (const row of batch.players ?? []) {
    const label = `${file}: ${row.name ?? row.player_id ?? "?"}`;
    if (!wantedIds.has(row.player_id)) errors.push(`${label}: not in the top 200`);
    if (positions.get(row.player_id) !== row.pos) errors.push(`${label}: position does not match cohort`);
    if (grades.has(row.player_id)) errors.push(`${label}: duplicate player_id`);
    if (!teamOffense.has(row.team_as_of_cutoff)) errors.push(`${label}: unknown team_as_of_cutoff`);
    if (!["researched", "conservative_default"].includes(row.evidence_status))
      errors.push(`${label}: missing evidence_status`);
    for (const [field, low, high] of [
      ["offense_raw", -2, 2], ["position_security", -2, 2],
      ["exp_games", 0, 17], ["upside", 0, 3],
    ]) {
      if (!Number.isFinite(row[field]) || row[field] < low || row[field] > high)
        errors.push(`${label}: ${field} must be ${low}..${high}`);
    }
    if (!row.note) errors.push(`${label}: missing note`);
    if (!row.sources?.length) errors.push(`${label}: missing sources`);
    for (const source of row.sources ?? []) {
      if (!validSource(source)) errors.push(`${label}: invalid or post-cutoff source ${source.url}`);
    }
    grades.set(row.player_id, row);
  }
}

for (const player of wanted) if (!grades.has(player.player_id)) errors.push(`missing: ${player.player_id} ${player.name}`);
if (grades.size !== 200) errors.push(`expected 200 unique grades, found ${grades.size}`);

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}

if (checkOnly) {
  console.log(`validated ${grades.size} grade records and source-date metadata across ${teamOffense.size} teams`);
  process.exit(0);
}

for (const player of draft.players) {
  const row = grades.get(player.player_id);
  if (!row) { player.grade = null; continue; }
  player.team = row.team_as_of_cutoff;
  player.grade = {
    offense: teamOffense.get(row.team_as_of_cutoff),
    position_security: row.position_security,
    exp_games: row.exp_games,
    upside: row.upside,
    note: row.note,
    sources: row.sources,
    offense_source: teamDocument.source,
    evidence_status: row.evidence_status,
    as_of: cutoff,
    graded_at: new Date().toISOString(),
  };
}
draft.grades = "Top 200 non-K/DEF players by best available ADP, researched using only sources published by 2025-08-29.";
draft.grades_cutoff = cutoff;
draft.grades_source = `${gradesPath}/graded-*.json`;
draft.grades_offense_source = `${gradesPath}/team-offense.json`;
draft.grades_selection = { count: 200, positions: ["QB", "RB", "WR", "TE"],
  adp: "minimum of std, half_ppr, ppr in existing archive" };
draft.grades_evidence_counts = Object.fromEntries(["researched", "conservative_default"].map((status) =>
  [status, [...grades.values()].filter((row) => row.evidence_status === status).length]));
draft.grades_caveat = "Retrospective reconstruction, not an archived grade snapshot. Source dates are validated but webpage immutability and absence of model hindsight cannot be proved. Conservative defaults are explicitly marked. Archived ADP/projections retain their original post-season provenance caveat.";
await writeFile(draftPath, `${JSON.stringify(draft)}\n`);
console.log(`embedded ${grades.size} normalized historical grades in ${draftPath}`);
