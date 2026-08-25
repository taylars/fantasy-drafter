"""Load leagues, rosters, and league membership for every tracked user.

    python3 -m scripts.load_leagues              # current season
    python3 -m scripts.load_leagues --season 2025
"""

from __future__ import annotations

import argparse

import db
from client.sleeper import SleeperClient


def scoring_type(league: dict) -> str | None:
    """Derive ppr / half_ppr / std from the scoring settings.

    The league object has no scoring_type field — only the draft object does —
    so infer it from the points-per-reception value.
    """
    rec = (league.get("scoring_settings") or {}).get("rec")
    if rec is None:
        return None
    if rec >= 1:
        return "ppr"
    return "half_ppr" if rec > 0 else "std"


def load_league(conn, sleeper, league: dict) -> None:
    """Upsert one league and its rosters."""
    db.upsert(
        conn,
        "leagues",
        {
            "league_id": league["league_id"],
            "name": league.get("name"),
            "season": league.get("season"),
            "sport": league.get("sport"),
            "status": league.get("status"),
            "total_rosters": league.get("total_rosters"),
            "scoring_type": scoring_type(league),
            "draft_id": league.get("draft_id"),
            "previous_league_id": league.get("previous_league_id"),
            "roster_positions": db.as_json(league.get("roster_positions")),
            "scoring_settings": db.as_json(league.get("scoring_settings")),
            "settings": db.as_json(league.get("settings")),
            "fetched_at": db.now(),
        },
        keys=("league_id",),
    )

    for roster in sleeper.get_league_rosters(league["league_id"]):
        db.upsert(
            conn,
            "rosters",
            {
                "league_id": league["league_id"],
                "roster_id": roster["roster_id"],
                "owner_id": roster.get("owner_id"),
                "players": db.as_json(roster.get("players")),
                "starters": db.as_json(roster.get("starters")),
                "settings": db.as_json(roster.get("settings")),
                "fetched_at": db.now(),
            },
            keys=("league_id", "roster_id"),
        )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--season", default=None, help="season year (defaults to current)")
    args = parser.parse_args()

    conn = db.connect()
    db.init(conn)

    users = db.tracked_users(conn)
    if not users:
        print("no users resolved — run `python3 -m scripts.load_users` first")
        return

    with SleeperClient() as sleeper:
        season = args.season or (sleeper.get_state() or {}).get("season")
        print(f"season {season}")

        for user in users:
            leagues = sleeper.get_user_leagues(user["user_id"], season)
            print(f"  {user['username']}: {len(leagues)} league(s)")
            for league in leagues:
                load_league(conn, sleeper, league)
                db.upsert(
                    conn,
                    "user_leagues",
                    {"username": user["username"], "league_id": league["league_id"]},
                    keys=("username", "league_id"),
                )
                print(f"    - {league.get('name')} ({league['league_id']})")

    conn.commit()
    conn.close()


if __name__ == "__main__":
    main()
