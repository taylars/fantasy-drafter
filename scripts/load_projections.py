"""Load season ADP and projections into the cache.

    python3 -m scripts.load_projections              # current season
    python3 -m scripts.load_projections --season 2026

Both numbers come from one Sleeper response: the ADP set for every scoring
format, and a Rotowire projected stat line. The stat line is stored whole so
each league can price it with its own scoring settings — see db.score_stats for
why the precomputed pts_* aren't good enough.

The endpoint is undocumented, so everything here reads defensively: a record
that has lost a field is skipped or stored partial, never fatal.
"""

from __future__ import annotations

import argparse

import db
from client.sleeper import SleeperClient

# Pulled out of `stats` into their own columns. Everything left over is the
# projected stat line and goes to the json column intact.
ADP_KEYS = {
    "adp_std": "adp_std",
    "adp_half_ppr": "adp_half_ppr",
    "adp_ppr": "adp_ppr",
    "adp_2qb": "adp_2qb",
    "adp_rookie": "adp_rookie",
    "adp_dynasty": "adp_dynasty",
}
PTS_KEYS = {"pts_std": "pts_std", "pts_half_ppr": "pts_half_ppr", "pts_ppr": "pts_ppr"}


def as_float(value) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def split_stats(stats: dict) -> tuple[dict, dict]:
    """Separate the adp_*/pts_*/gp columns from the projected stat line."""
    columns = {}
    for source, column in {**ADP_KEYS, **PTS_KEYS}.items():
        columns[column] = as_float(stats.get(source))
    columns["gp"] = as_float(stats.get("gp"))

    line = {
        key: value
        for key, value in stats.items()
        # Every adp_* variant goes, including the dynasty_* ones we don't store,
        # so they can't be mistaken for a scoring stat later.
        if not key.startswith(("adp_", "pts_")) and key != "gp"
        and isinstance(value, (int, float))
    }
    return columns, line


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--season", default=None, help="season year (defaults to current)")
    args = parser.parse_args()

    conn = db.connect()
    db.init(conn)

    known = {r[0] for r in conn.execute("SELECT player_id FROM players")}
    if not known:
        raise SystemExit("no players in the cache — run load_players first")

    with SleeperClient() as sleeper:
        season = args.season or (sleeper.get_state() or {}).get("season")
        if not season:
            raise SystemExit("could not determine the season — pass --season")
        records = sleeper.get_projections(season)

    fetched_at = db.now()
    stored = projected = skipped = 0

    for record in records:
        player_id = record.get("player_id")
        stats = record.get("stats")
        if not player_id or not isinstance(stats, dict):
            continue
        # A projection for a position we don't track has nowhere to hang:
        # the table keys off players, which load_players trims by position.
        if player_id not in known:
            skipped += 1
            continue

        columns, line = split_stats(stats)
        if line:
            projected += 1

        db.upsert(
            conn,
            "player_projections",
            {
                "player_id": player_id,
                "season": str(season),
                **columns,
                "stats": db.as_json(line) if line else None,
                "company": record.get("company"),
                "updated_at": record.get("updated_at"),
                "fetched_at": fetched_at,
            },
            keys=("player_id", "season"),
        )
        stored += 1

    conn.commit()
    print(f"  {stored} projection row(s) for {season}, {projected} with a stat line "
          f"({skipped} skipped, no player row)")
    conn.close()


if __name__ == "__main__":
    main()
