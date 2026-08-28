#!/usr/bin/env node
// Enrich existing actual-week fixtures without changing draft inputs or scores.
// node bin/historical-week-inputs.mjs --season=2025 [--week=1]
import { readFile, writeFile } from 'node:fs/promises';
import { SleeperClient, POSITIONS } from '../js/sleeper.js';
import { scoreStats } from '../js/pool.js';
import { parseCsv, injuryDesignation } from '../js/historical-week.js';

const season = process.argv.find(a => a.startsWith('--season='))?.split('=')[1];
if (!/^\d{4}$/.test(season ?? '')) throw new Error('Use --season=YYYY');
const weekArg = process.argv.find(a => a.startsWith('--week='))?.split('=')[1];
if (weekArg && (!Number.isInteger(Number(weekArg)) || +weekArg < 1 || +weekArg > 18)) {
  throw new Error('Week must be 1–18');
}
const root = new URL(`../data/historical/${season}/`, import.meta.url);
const draft = JSON.parse(await readFile(new URL('draft.json', root), 'utf8'));
const rosterSource = `https://github.com/nflverse/nflverse-data/releases/download/weekly_rosters/roster_weekly_${season}.csv`;
const injurySource = `https://github.com/nflverse/nflverse-data/releases/download/injuries/injuries_${season}.csv`;
async function csv(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return parseCsv(await res.text());
}
const [rosters, reports] = await Promise.all([csv(rosterSource), csv(injurySource)]);
const client = new SleeperClient({ timeout: 30000, retries: 3 });
const score = stats => Object.fromEntries(Object.entries(draft.scoring)
  .map(([format, settings]) => [format, scoreStats(stats, settings)]));

for (const week of weekArg ? [+weekArg] : Array.from({ length: 17 }, (_, i) => i + 1)) {
  const path = new URL(`weeks/week-${String(week).padStart(2, '0')}.json`, root);
  const fixture = JSON.parse(await readFile(path, 'utf8'));
  const projectionSource = `https://api.sleeper.app/projections/nfl/${season}/${week}?season_type=regular`;
  const statsSource = `https://api.sleeper.app/stats/nfl/${season}/${week}?season_type=regular`;
  const [projections, stats] = await Promise.all([client.request(projectionSource), client.request(statsSource)]);
  if (!Array.isArray(projections) || !projections.length || !Array.isArray(stats) || !stats.length) {
    throw new Error(`Missing weekly records for ${season}/${week}`);
  }
  const weeklyRosters = rosters.filter(r => r.season === season && +r.week === week && r.game_type === 'REG');
  const weeklyReports = reports.filter(r => r.season === season && +r.week === week && r.game_type === 'REG');
  if (!weeklyRosters.length || !weeklyReports.length) throw new Error(`Missing injury/roster archive for ${season}/${week}`);
  const rosterById = new Map(weeklyRosters.filter(r => r.sleeper_id).map(r => [r.sleeper_id, r]));
  const reportById = new Map(weeklyReports.map(r => [r.gsis_id, r]));
  const projectionById = new Map(projections.filter(r => POSITIONS.includes(r.player?.position))
    .map(r => [r.player_id, r]));
  const statsById = new Map(stats.map(r => [r.player_id, r]));
  const playingTeams = new Set(projections.filter(r => r.game_id && r.opponent).map(r => r.team));
  const players = new Map(draft.players.map(p => [p.player_id, p]));
  for (const [id, r] of projectionById) if (!players.has(id) && Object.values(score(r.stats)).some(n => n > 0)) {
    players.set(id, { player_id: id, name: `${r.player.first_name} ${r.player.last_name}`,
      position: r.player.position, team: r.team });
  }
  fixture.weekly_inputs = {
    captured: new Date().toISOString(), projection_source: projectionSource,
    stats_source: statsSource, injury_source: injurySource, roster_source: rosterSource,
    caveat: 'Archived weekly projections, not verified pre-kickoff snapshots; modification timestamps may be after games. Embedded Sleeper player injury fields are current and are never used. Injury eligibility uses weekly nflverse Out/IR/PUP designations; questionable/doubtful and in-game injuries are not automatically replaced.',
  };
  fixture.projections = {}; fixture.injured = {}; fixture.weekly_players = {};
  for (const [id, player] of players) {
    const projection = projectionById.get(id);
    const roster = rosterById.get(id);
    const report = reportById.get(roster?.gsis_id);
    const rawTeam = roster?.team ?? projection?.team ?? player.team;
    const team = rawTeam === 'LA' ? 'LAR' : rawTeam;
    const injury = injuryDesignation(roster, report);
    fixture.weekly_players[id] = { name: player.name, position: player.position, team };
    fixture.projections[id] = {
      points: projection ? score(projection.stats) : null,
      updated_at: projection?.updated_at ?? null,
      game_date: projection?.date ?? null,
      scheduled: playingTeams.has(team),
    };
    if (injury && playingTeams.has(team)) fixture.injured[id] = injury;
    // Preserve the existing captured results; add only the expanded waiver pool.
    if (!(id in fixture.points)) fixture.points[id] = score(statsById.get(id)?.stats ?? {});
  }
  await writeFile(path, `${JSON.stringify(fixture)}\n`);
  console.log(`Week ${week}: ${players.size} players, ${Object.keys(fixture.injured).length} injury replacements eligible`);
}
