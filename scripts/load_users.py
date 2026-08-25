"""Resolve each seeded username to a Sleeper user_id.

    python3 -m scripts.load_users

Run this before load_leagues — everything downstream keys off user_id.
"""

from __future__ import annotations

import db
from client.sleeper import SleeperClient


def main() -> None:
    conn = db.connect()
    db.init(conn)

    names = db.usernames(conn)
    if not names:
        print("no users seeded — run `python3 -m scripts.init_db` first")
        return

    with SleeperClient() as sleeper:
        for name in names:
            user = sleeper.get_user(name)
            if not user:
                print(f"  {name}: not found on Sleeper")
                continue
            db.upsert(
                conn,
                "users",
                {
                    "username": name,
                    "user_id": user["user_id"],
                    "display_name": user.get("display_name"),
                    "avatar": user.get("avatar"),
                    "fetched_at": db.now(),
                },
                keys=("username",),
            )
            print(f"  {name}: user_id {user['user_id']}")

    conn.commit()
    conn.close()


if __name__ == "__main__":
    main()
