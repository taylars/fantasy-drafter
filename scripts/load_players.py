"""Load the NFL player file into the cache.

    python3 -m scripts.load_players            # the fantasy positions only
    python3 -m scripts.load_players --all      # every player Sleeper knows

The API response is ~16 MB, so the client caches it on disk for 24h and this
reads through that cache. Pass --refresh to force a new fetch.
"""

from __future__ import annotations

import argparse

import db
from client.sleeper import PLAYER_CACHE_MAX_AGE, SleeperClient, fantasy_relevant


def full_name(player: dict) -> str | None:
    """Team defenses have no full_name — only first_name/last_name."""
    name = player.get("full_name")
    if name:
        return name
    parts = [player.get("first_name"), player.get("last_name")]
    return " ".join(p for p in parts if p) or None


def as_int(value) -> int | None:
    """Sleeper returns some numeric fields as strings, others as null."""
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--all", action="store_true", help="keep non-fantasy positions too (OL, DL, ...)")
    parser.add_argument("--refresh", action="store_true", help="ignore the 24h disk cache")
    args = parser.parse_args()

    conn = db.connect()
    db.init(conn)

    with SleeperClient() as sleeper:
        players = sleeper.get_all_players(max_age=0 if args.refresh else PLAYER_CACHE_MAX_AGE)

    total = len(players)
    if not args.all:
        players = fantasy_relevant(players)

    fetched_at = db.now()
    for player_id, player in players.items():
        db.upsert(
            conn,
            "players",
            {
                "player_id": player_id,
                "full_name": full_name(player),
                "first_name": player.get("first_name"),
                "last_name": player.get("last_name"),
                "position": player.get("position"),
                "fantasy_positions": db.as_json(player.get("fantasy_positions")),
                "team": player.get("team"),
                "status": player.get("status"),
                "injury_status": player.get("injury_status"),
                "age": as_int(player.get("age")),
                "years_exp": as_int(player.get("years_exp")),
                "number": as_int(player.get("number")),
                "search_rank": as_int(player.get("search_rank")),
                "depth_chart_order": as_int(player.get("depth_chart_order")),
                "fetched_at": fetched_at,
            },
            keys=("player_id",),
        )

    conn.commit()
    kept = "all" if args.all else "fantasy-position"
    print(f"  {len(players)} {kept} player(s) stored (of {total} from Sleeper)")
    conn.close()


if __name__ == "__main__":
    main()
