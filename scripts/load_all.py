"""Run every loader in dependency order.

    python3 -m scripts.load_all
    python3 -m scripts.load_all --season 2025

This is the one to run to build the cache from nothing, and the one to re-run
to refresh it. Each step is idempotent, so it's safe either way.
"""

from __future__ import annotations

import argparse
import sys

import db
from scripts import (
    init_db, load_drafts, load_leagues, load_players,
    load_projections, load_users,
)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--season", default=None, help="season year (defaults to current)")
    parser.add_argument("--skip-players", action="store_true", help="skip the 16 MB player file")
    args = parser.parse_args()

    season_args = ["--season", args.season] if args.season else []

    steps: list[tuple[str, callable, list[str]]] = [
        ("init_db", init_db.main, []),
        ("load_users", load_users.main, []),
        ("load_leagues", load_leagues.main, season_args),
        ("load_drafts", load_drafts.main, []),
    ]
    if not args.skip_players:
        steps.append(("load_players", load_players.main, []))
    # Projections key off the players table, so they follow it.
    steps.append(("load_projections", load_projections.main, season_args))

    for name, run, argv in steps:
        print(f"\n== {name}")
        # Each loader parses its own argv, so hand it the flags it expects.
        sys.argv = [name, *argv]
        run()

    conn = db.connect()
    print("\n== summary")
    tables = ("users", "leagues", "user_leagues", "rosters", "drafts", "draft_picks",
              "players", "player_projections", "player_grades")
    for table in tables:
        count = conn.execute(f"SELECT count(*) FROM {table}").fetchone()[0]
        print(f"  {table:<14} {count:>6}")
    conn.close()


if __name__ == "__main__":
    main()
