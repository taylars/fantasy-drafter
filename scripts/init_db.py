"""Create the database and seed the usernames we pull data for.

    python3 -m scripts.init_db                 # seeds the default username
    python3 -m scripts.init_db alice bob       # seeds these instead

Existing users and tables are left alone, so this is safe to re-run.
"""

from __future__ import annotations

import argparse

import db

DEFAULT_USERNAMES = ["taylars"]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("usernames", nargs="*", default=None, help="Sleeper usernames to track")
    args = parser.parse_args()

    names = args.usernames or DEFAULT_USERNAMES

    conn = db.connect()
    db.init(conn)
    for name in names:
        # Only the username is seeded; load_users fills in the rest. Leaving
        # user_id out of the upsert means re-running this never clears it.
        db.upsert(conn, "users", {"username": name}, keys=("username",))
    conn.commit()

    print(f"database ready at {db.DB_PATH}")
    print(f"tracking {len(db.usernames(conn))} user(s): {', '.join(db.usernames(conn))}")
    conn.close()


if __name__ == "__main__":
    main()
