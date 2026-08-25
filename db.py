"""SQLite cache for Sleeper data.

Everything in here is a cache. The database can be deleted and rebuilt from
scratch by re-running the loaders in scripts/ — nothing lives here that can't be
reproduced, either from Sleeper or from the two files we keep by hand: the
seeded usernames, and board.json.

All writes go through `upsert`, keyed on Sleeper's own ids, so every loader is
idempotent: running one twice leaves the same rows behind.

Schema changes go in migrations/NNN_name.sql and are applied in order by
`init`. The database is still a cache, but it no longer has to be thrown away
to change shape.
"""

from __future__ import annotations

import datetime
import json
import pathlib
import sqlite3

DB_PATH = pathlib.Path("data/fantasy.db")

MIGRATIONS_DIR = pathlib.Path(__file__).parent / "migrations"


def connect(path: pathlib.Path = DB_PATH) -> sqlite3.Connection:
    """Open the cache, creating the parent directory if needed."""
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def migrations() -> list[tuple[int, pathlib.Path]]:
    """Every migration on disk as (version, path), lowest version first.

    A migration is named NNN_description.sql; the leading number is the
    user_version the database is at once it has been applied.
    """
    found = []
    for path in sorted(MIGRATIONS_DIR.glob("*.sql")):
        try:
            version = int(path.name.split("_", 1)[0])
        except ValueError:
            continue
        found.append((version, path))
    return found


def init(conn: sqlite3.Connection, quiet: bool = False) -> None:
    """Apply any migration the database hasn't seen yet.

    Safe to run repeatedly and safe against an existing database: `user_version`
    records how far it has got, and only higher-numbered migrations run. Nothing
    is dropped, so cached data survives a schema change.

    Each migration commits on its own — sqlite's executescript ends any open
    transaction — so a failure part-way leaves the migrations before it applied
    and user_version pointing at the last one that succeeded.
    """
    version = conn.execute("PRAGMA user_version").fetchone()[0]
    pending = [(v, path) for v, path in migrations() if v > version]
    if not pending:
        return

    for target, path in pending:
        try:
            conn.executescript(path.read_text())
        except sqlite3.Error as exc:
            raise RuntimeError(f"migration {path.name} failed: {exc}") from exc
        conn.execute(f"PRAGMA user_version = {target}")
        conn.commit()
        if not quiet:
            print(f"  applied {path.name}")

    if not quiet:
        print(f"schema v{version} -> v{pending[-1][0]}")


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


# --------------------------------------------------------------- projections

# Sleeper publishes ADP once per scoring format. A league reads the one that
# matches its own scoring_type; anything unrecognised falls back to half PPR,
# which is the middle of the three and the least wrong default.
ADP_COLUMNS = {
    "std": "adp_std",
    "half_ppr": "adp_half_ppr",
    "ppr": "adp_ppr",
    "2qb": "adp_2qb",
    "dynasty": "adp_dynasty",
}


def adp_column(scoring_type: str | None) -> str:
    """The player_projections column holding ADP for a league's format."""
    return ADP_COLUMNS.get(scoring_type or "", "adp_half_ppr")


def score_stats(stats: dict, scoring_settings: dict) -> float:
    """Turn a projected stat line into points under one league's scoring.

    Only keys the league actually scores contribute, so a stat line carrying
    IDP or return-game keys the league ignores costs nothing. This is why the
    stat line is stored whole rather than as a precomputed total: the same
    projection scores differently in two leagues, and Sleeper's own pts_* are
    generic (their half PPR preset docks an interception 1 point, where a
    league may say 2).
    """
    return round(
        sum(
            value * scoring_settings[key]
            for key, value in stats.items()
            if key in scoring_settings and isinstance(value, (int, float))
        ),
        2,
    )


def league_scoring(conn: sqlite3.Connection, league_id: str) -> dict:
    """One league's scoring_settings, decoded."""
    row = conn.execute(
        "SELECT scoring_settings FROM leagues WHERE league_id = ?", (league_id,)
    ).fetchone()
    if row is None or row["scoring_settings"] is None:
        return {}
    return json.loads(row["scoring_settings"])


def projected_points(conn: sqlite3.Connection, league_id: str, season: str | None = None) -> dict[str, float]:
    """Projected season points for every player, under this league's scoring.

    Returns {player_id: points}. Players without a projected stat line are
    absent rather than zero — a missing projection and a projection of nothing
    are different things, and the caller should be able to tell them apart.
    """
    scoring = league_scoring(conn, league_id)
    if not scoring:
        return {}

    if season is None:
        row = conn.execute("SELECT season FROM leagues WHERE league_id = ?", (league_id,)).fetchone()
        season = row["season"] if row else None

    points = {}
    for row in conn.execute(
        "SELECT player_id, stats FROM player_projections WHERE season = ? AND stats IS NOT NULL",
        (season,),
    ):
        points[row["player_id"]] = score_stats(json.loads(row["stats"]), scoring)
    return points
