"""Load the hand-written draft board into the cache.

    python3 -m scripts.load_board                    # board.json
    python3 -m scripts.load_board my-other-board.json
    python3 -m scripts.load_board --league <id>      # override the target league

board.json holds the turns and the players tagged at each one — the only
opinions in this repo, and the one thing the Sleeper loaders can't produce.
This resolves those names to Sleeper player_ids and writes them to
board_turns / player_tags for the league named in the file.

Players are matched on name plus position, since Sleeper drops suffixes ("Brian
Robinson", not "Brian Robinson Jr."). A name that matches nothing, or matches
two players, is reported and skipped rather than guessed at.
"""

from __future__ import annotations

import argparse
import json
import pathlib
import re
import sqlite3
import sys

import db

BOARD_PATH = pathlib.Path("board.json")

# Sleeper stores "Brian Robinson", never "Brian Robinson Jr.", and punctuates
# inconsistently. Normalizing both sides makes the match exact rather than fuzzy.
SUFFIXES = re.compile(r"\b(jr|sr|ii|iii|iv|v)\b")


def normalize(name: str) -> str:
    """Fold a player name to the form both sides can be compared on."""
    folded = name.lower().replace(".", "").replace("'", "").replace("-", " ")
    return " ".join(SUFFIXES.sub("", folded).split())


def player_index(conn: sqlite3.Connection) -> dict[tuple[str, str], list[sqlite3.Row]]:
    """Every player keyed on (normalized name, position).

    A list rather than a single row: two players can share a name and position,
    and we'd rather report that than pick one.
    """
    index: dict[tuple[str, str], list[sqlite3.Row]] = {}
    for row in conn.execute("SELECT player_id, full_name, position, team FROM players"):
        index.setdefault((normalize(row["full_name"]), row["position"]), []).append(row)
    return index


def resolve(entry: dict, index: dict, conn: sqlite3.Connection) -> tuple[str | None, str | None]:
    """Find the player_id for one board entry, or explain why we can't.

    Returns (player_id, problem) — exactly one of the two is set.
    """
    # Team defenses are keyed on the team abbreviation, and their full_name is
    # the city plus nickname ("Philadelphia Eagles"), so the name won't match.
    if entry["pos"] == "DEF":
        row = conn.execute(
            "SELECT player_id FROM players WHERE player_id = ? AND position = 'DEF'",
            (entry["team"],),
        ).fetchone()
        return (row["player_id"], None) if row else (None, f"no defense for {entry['team']}")

    matches = index.get((normalize(entry["name"]), entry["pos"]), [])
    if not matches:
        return None, "no player of that name and position"
    if len(matches) > 1:
        teams = ", ".join(m["team"] or "?" for m in matches)
        return None, f"ambiguous — {len(matches)} players ({teams})"

    match = matches[0]
    # The team isn't used to match, but disagreeing with it means the board is
    # stale or we've landed on the wrong player. Worth saying out loud.
    if entry.get("team") and match["team"] and entry["team"] != match["team"]:
        print(f"    note: {entry['name']} is on {match['team']}, board says {entry['team']}")
    return match["player_id"], None


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("board", nargs="?", default=BOARD_PATH, type=pathlib.Path,
                        help=f"board file to load (default: {BOARD_PATH})")
    parser.add_argument("--league", default=None, help="league_id to tag against")
    args = parser.parse_args()

    if not args.board.exists():
        sys.exit(f"no board at {args.board}")

    board = json.loads(args.board.read_text())
    league_id = args.league or board.get("league_id")
    if not league_id:
        sys.exit("no league_id — pass --league or set one in the board file")

    conn = db.connect()
    db.init(conn)

    league = conn.execute("SELECT name FROM leagues WHERE league_id = ?", (league_id,)).fetchone()
    if league is None:
        sys.exit(f"league {league_id} isn't in the cache — run load_leagues first")

    if not conn.execute("SELECT 1 FROM players LIMIT 1").fetchone():
        sys.exit("no players in the cache — run load_players first")

    # The board is a whole opinion, not a set of independent rows: a player
    # dropped from the file should leave the table. Clearing this league's tags
    # first keeps the database matching the file exactly.
    conn.execute("DELETE FROM player_tags WHERE league_id = ?", (league_id,))
    conn.execute("DELETE FROM board_turns WHERE league_id = ?", (league_id,))

    index = player_index(conn)
    tagged_at = db.now()
    counts = {"favorite": 0, "watch": 0}
    skipped = []

    for turn_no, turn in enumerate(board["turns"], start=1):
        db.upsert(
            conn,
            "board_turns",
            {
                "league_id": league_id,
                "turn_no": turn_no,
                "picks": turn.get("picks"),
                "round": turn.get("round"),
                "plan": turn.get("plan"),
                "note": turn.get("note"),
            },
            keys=("league_id", "turn_no"),
        )

        for sort_order, entry in enumerate(turn["players"]):
            player_id, problem = resolve(entry, index, conn)
            if problem:
                skipped.append((entry["name"], problem))
                continue
            kind = entry.get("kind", "watch")
            db.upsert(
                conn,
                "player_tags",
                {
                    "league_id": league_id,
                    "player_id": player_id,
                    "kind": kind,
                    "turn_no": turn_no,
                    "sort_order": sort_order,
                    "note": entry.get("note"),
                    "tie": entry.get("tie"),
                    "flag": entry.get("flag"),
                    "tagged_at": tagged_at,
                },
                keys=("league_id", "player_id"),
            )
            counts[kind] = counts.get(kind, 0) + 1

    conn.commit()

    print(f"  {league['name']}: {len(board['turns'])} turn(s), "
          f"{counts['favorite']} favorite(s), {counts['watch']} watched")
    for name, problem in skipped:
        print(f"    skipped {name}: {problem}")
    conn.close()


if __name__ == "__main__":
    main()
