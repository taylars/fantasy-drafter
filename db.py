"""SQLite cache for Sleeper data.

Everything in here is a cache. The database can be deleted and rebuilt from
scratch by re-running the loaders in scripts/ — nothing lives here that can't be
reproduced, either from Sleeper or from the two files we keep by hand: the
seeded usernames, and board.json.

All writes go through `upsert`, keyed on Sleeper's own ids, so every loader is
idempotent: running one twice leaves the same rows behind.
"""

from __future__ import annotations

import datetime
import json
import pathlib
import sqlite3

DB_PATH = pathlib.Path("data/fantasy.db")

# Bump when the schema changes. Because this is a pure cache, `init` responds by
# dropping everything and rebuilding — the seeded usernames are carried across,
# since they're the one thing Sleeper can't tell us again.
SCHEMA_VERSION = 4

SCHEMA = """
-- The usernames we want to pull data for. Seeded by hand; everything else in
-- the database hangs off this table.
CREATE TABLE IF NOT EXISTS users (
    username     TEXT PRIMARY KEY,
    user_id      TEXT UNIQUE,          -- null until load_users resolves it
    display_name TEXT,
    avatar       TEXT,
    fetched_at   TEXT
);

CREATE TABLE IF NOT EXISTS leagues (
    league_id        TEXT PRIMARY KEY,
    name             TEXT,
    season           TEXT,
    sport            TEXT,
    status           TEXT,
    total_rosters    INTEGER,
    scoring_type     TEXT,             -- ppr / half_ppr / std
    draft_id         TEXT,
    previous_league_id TEXT,
    roster_positions TEXT,             -- json array
    scoring_settings TEXT,             -- json object
    settings         TEXT,             -- json object
    fetched_at       TEXT
);

-- Which of our users is in which league. A league can outlive a user's
-- interest in it, so this is a link table rather than a column on leagues.
CREATE TABLE IF NOT EXISTS user_leagues (
    username  TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE,
    league_id TEXT NOT NULL REFERENCES leagues(league_id) ON DELETE CASCADE,
    PRIMARY KEY (username, league_id)
);

CREATE TABLE IF NOT EXISTS rosters (
    league_id  TEXT NOT NULL REFERENCES leagues(league_id) ON DELETE CASCADE,
    roster_id  INTEGER NOT NULL,
    owner_id   TEXT,
    players    TEXT,                   -- json array of player_id
    starters   TEXT,                   -- json array of player_id
    settings   TEXT,                   -- json object (wins, losses, fpts...)
    fetched_at TEXT,
    PRIMARY KEY (league_id, roster_id)
);

CREATE TABLE IF NOT EXISTS drafts (
    draft_id          TEXT PRIMARY KEY,
    -- Null for mock drafts. Deliberately not a foreign key: a draft can
    -- reference a league we don't track.
    league_id         TEXT,
    is_mock           INTEGER,
    -- A "league_mock" is seeded from a real league's settings and records it
    -- under metadata.league_id, even though league_id above is null and the
    -- league's own /drafts endpoint won't return it.
    mock_type         TEXT,
    source_league_id  TEXT,
    creators          TEXT,             -- json array of user_id
    season            TEXT,
    sport             TEXT,
    type              TEXT,            -- snake / linear / auction
    status            TEXT,            -- pre_draft / drafting / paused / complete
    start_time        INTEGER,         -- epoch ms
    last_picked       INTEGER,         -- epoch ms
    teams             INTEGER,
    rounds            INTEGER,
    pick_timer        INTEGER,
    reversal_round    INTEGER,
    scoring_type      TEXT,
    draft_order       TEXT,            -- json {user_id: slot}, null pre-order
    slot_to_roster_id TEXT,            -- json {slot: roster_id}, null pre-order
    settings          TEXT,            -- json object
    fetched_at        TEXT
);

CREATE TABLE IF NOT EXISTS draft_picks (
    draft_id    TEXT NOT NULL REFERENCES drafts(draft_id) ON DELETE CASCADE,
    pick_no     INTEGER NOT NULL,
    round       INTEGER,
    draft_slot  INTEGER,
    roster_id   INTEGER,
    player_id   TEXT,
    picked_by   TEXT,                  -- "" on autopicks; fall back to roster_id
    is_keeper   INTEGER,
    metadata    TEXT,                  -- json: name, position, team, amount...
    fetched_at  TEXT,
    PRIMARY KEY (draft_id, pick_no)
);

CREATE INDEX IF NOT EXISTS idx_picks_player ON draft_picks(draft_id, player_id);
CREATE INDEX IF NOT EXISTS idx_drafts_league ON drafts(league_id);

CREATE TABLE IF NOT EXISTS players (
    player_id         TEXT PRIMARY KEY,
    full_name         TEXT,
    first_name        TEXT,
    last_name         TEXT,
    position          TEXT,
    fantasy_positions TEXT,            -- json array; a player can be RB/WR
    team              TEXT,
    status            TEXT,
    injury_status     TEXT,
    age               INTEGER,
    years_exp         INTEGER,
    number            INTEGER,
    search_rank       INTEGER,         -- crude ADP proxy, low = more relevant
    depth_chart_order INTEGER,
    fetched_at        TEXT
);

CREATE INDEX IF NOT EXISTS idx_players_pos ON players(position, search_rank);
CREATE INDEX IF NOT EXISTS idx_players_name ON players(full_name);

-- The turns of one league's draft board: the picks we own, and the plan for
-- each. Ordering is turn_no, not pick number, so a turn can hold two picks
-- ("24 · 25") the way a snake draft's wrap-around actually plays.
CREATE TABLE IF NOT EXISTS board_turns (
    league_id TEXT NOT NULL REFERENCES leagues(league_id) ON DELETE CASCADE,
    turn_no   INTEGER NOT NULL,        -- 1-based, in board order
    picks     TEXT,                    -- pick numbers as shown, e.g. "24 · 25"
    round     TEXT,
    plan      TEXT,                    -- the headline for the turn
    note      TEXT,                    -- the reasoning behind it
    PRIMARY KEY (league_id, turn_no)
);

-- Players we're tracking, per league. `favorite` is one we want to take at a
-- given turn; `watch` is everyone else worth knowing about in that range.
-- A player holds at most one tag per league, so favoriting a watched player
-- promotes the existing row rather than adding a second one.
--
-- Unlike the rest of this database these rows are ours, not Sleeper's, but
-- they're still a cache: scripts/load_board.py rebuilds them from board.json.
CREATE TABLE IF NOT EXISTS player_tags (
    league_id  TEXT NOT NULL REFERENCES leagues(league_id) ON DELETE CASCADE,
    player_id  TEXT NOT NULL REFERENCES players(player_id) ON DELETE CASCADE,
    kind       TEXT NOT NULL CHECK (kind IN ('favorite', 'watch')),
    turn_no    INTEGER,                -- the turn to consider him at
    sort_order INTEGER,                -- position within that turn
    -- The board's own ADP snapshot. Sleeper publishes no ADP, so it comes in
    -- with the board rather than from the players table.
    adp        REAL,
    note       TEXT,                   -- why he's tagged; favorites carry one
    tie        TEXT,                   -- "take whichever is there" and friends
    flag       TEXT,                   -- short warning: "adp rising", "your pick"
    tagged_at  TEXT,
    PRIMARY KEY (league_id, player_id),
    FOREIGN KEY (league_id, turn_no) REFERENCES board_turns(league_id, turn_no) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tags_turn ON player_tags(league_id, turn_no, sort_order);
CREATE INDEX IF NOT EXISTS idx_tags_kind ON player_tags(league_id, kind);
"""


def connect(path: pathlib.Path = DB_PATH) -> sqlite3.Connection:
    """Open the cache, creating the parent directory if needed."""
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init(conn: sqlite3.Connection) -> None:
    """Create any missing tables, rebuilding if the schema version moved on.

    Safe to run against an existing database, and safe to run repeatedly.
    """
    version = conn.execute("PRAGMA user_version").fetchone()[0]
    tables = [
        r[0]
        for r in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'")
    ]

    if tables and version != SCHEMA_VERSION:
        # Everything except the seeded usernames is re-fetchable, so the cheapest
        # correct migration is to throw it away and reload.
        seeded = usernames(conn)
        conn.execute("PRAGMA foreign_keys = OFF")
        for table in tables:
            conn.execute(f"DROP TABLE IF EXISTS {table}")
        conn.execute("PRAGMA foreign_keys = ON")
        conn.executescript(SCHEMA)
        for name in seeded:
            upsert(conn, "users", {"username": name}, keys=("username",))
        print(f"schema v{version} -> v{SCHEMA_VERSION}: cache rebuilt, re-run the loaders")
    else:
        conn.executescript(SCHEMA)

    conn.execute(f"PRAGMA user_version = {SCHEMA_VERSION}")
    conn.commit()


def now() -> str:
    """UTC timestamp for fetched_at columns."""
    return datetime.datetime.now(datetime.UTC).isoformat(timespec="seconds")


def as_json(value) -> str | None:
    """Serialize a dict/list column, preserving null."""
    return None if value is None else json.dumps(value)


def upsert(conn: sqlite3.Connection, table: str, row: dict, keys: tuple[str, ...]) -> None:
    """Insert a row, or update it in place if the key already exists.

    This is what makes the loaders idempotent — re-running one refreshes the
    existing rows rather than duplicating or failing on them.
    """
    columns = list(row)
    placeholders = ", ".join("?" * len(columns))
    updates = ", ".join(f"{c} = excluded.{c}" for c in columns if c not in keys)
    conflict = f"DO UPDATE SET {updates}" if updates else "DO NOTHING"
    conn.execute(
        f"INSERT INTO {table} ({', '.join(columns)}) VALUES ({placeholders}) "
        f"ON CONFLICT({', '.join(keys)}) {conflict}",
        [row[c] for c in columns],
    )


def usernames(conn: sqlite3.Connection) -> list[str]:
    """Every seeded username."""
    return [r["username"] for r in conn.execute("SELECT username FROM users ORDER BY username")]


def tracked_users(conn: sqlite3.Connection) -> list[sqlite3.Row]:
    """Seeded users that have had their user_id resolved by load_users."""
    return list(
        conn.execute("SELECT username, user_id FROM users WHERE user_id IS NOT NULL ORDER BY username")
    )
