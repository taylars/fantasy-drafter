"""Load researched player grades into the cache.

    python3 -m scripts.load_grades                      # every data/grades/graded-*.json
    python3 -m scripts.load_grades data/grades/graded-03.json
    python3 -m scripts.load_grades --dry-run            # check a batch without writing

Grades come back from research as one json file per batch (see
.claude/skills/grade-players for what produces them, and
docs/value-formula.md for what consumes them). This is the only thing that
writes to `player_grades`.

This does not clear before it writes. Grades are independent facts about
independent players, and a batch that covers 25 of them says nothing about the
other 175. So every file is an upsert over the players it names and nothing
else, which is also what makes a single bad batch safe to re-run on its own.

A file is rejected whole if any row in it is malformed. A batch is a unit of
research, and a half-loaded one is harder to reason about than a rejected one.
"""

from __future__ import annotations

import argparse
import json
import pathlib
import sqlite3
import sys

import db
from scripts.names import player_index, normalize

GRADES_DIR = pathlib.Path("data/grades")

# Mirrors the CHECK constraints in migrations/007, so a bad grade is reported
# against its player and file rather than as a sqlite error.
RANGES = {"offense": (-2, 2), "position_security": (-2, 2),
          "upside": (0, 3), "exp_games": (0, 17)}
REQUIRED = ("offense", "position_security", "exp_games", "upside")


def resolve(entry: dict, index: dict, conn: sqlite3.Connection) -> tuple[str | None, str | None]:
    """Find the player_id for one graded entry, or explain why we can't.

    The queue hands out player_id, so that is the normal path; the name lookup
    is the fallback for a file written by hand.
    """
    if entry.get("player_id"):
        row = conn.execute("SELECT player_id FROM players WHERE player_id = ?",
                           (entry["player_id"],)).fetchone()
        return (row["player_id"], None) if row else (None, f"no player {entry['player_id']}")

    if not entry.get("name") or not entry.get("pos"):
        return None, "no player_id, and no name/pos to fall back on"

    matches = index.get((normalize(entry["name"]), entry["pos"]), [])
    if not matches:
        return None, "no player of that name and position"
    if len(matches) > 1:
        return None, f"ambiguous — {len(matches)} players"
    return matches[0]["player_id"], None


def problems(entry: dict) -> list[str]:
    """Everything wrong with one graded entry, so a batch reports in one pass."""
    found = []
    for field in REQUIRED:
        if entry.get(field) is None:
            found.append(f"missing {field}")
            continue
        value = entry[field]
        if not isinstance(value, (int, float)):
            found.append(f"{field} is not a number")
            continue
        low, high = RANGES[field]
        if not low <= value <= high:
            found.append(f"{field}={value} outside {low}..{high}")
    if not entry.get("sources"):
        found.append("no sources — a grade nobody can check isn't worth storing")
    if not entry.get("note"):
        found.append("no note")
    return found


def load_file(path: pathlib.Path, conn: sqlite3.Connection, index: dict,
              dry_run: bool) -> tuple[int, list[str]]:
    """Validate one batch file and write it, or report why it was rejected."""
    try:
        batch = json.loads(path.read_text())
    except json.JSONDecodeError as exc:
        return 0, [f"not valid json: {exc}"]

    season = batch.get("season")
    if not season:
        return 0, ["no season in the file"]

    rows, errors = [], []
    for entry in batch.get("players", []):
        who = entry.get("name") or entry.get("player_id") or "?"
        player_id, problem = resolve(entry, index, conn)
        if problem:
            errors.append(f"{who}: {problem}")
            continue
        for bad in problems(entry):
            errors.append(f"{who}: {bad}")
        rows.append({
            "player_id": player_id,
            "season": season,
            "offense": entry.get("offense"),
            "position_security": entry.get("position_security"),
            "exp_games": entry.get("exp_games"),
            "upside": entry.get("upside"),
            "note": entry.get("note"),
            "sources": db.as_json(entry.get("sources")),
            "graded_at": db.now(),
        })

    if errors:
        return 0, errors
    if dry_run:
        return len(rows), []

    for row in rows:
        db.upsert(conn, "player_grades", row, keys=("player_id", "season"))
    return len(rows), []


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("files", nargs="*", type=pathlib.Path,
                        help=f"batch files to load (default: {GRADES_DIR}/graded-*.json)")
    parser.add_argument("--dry-run", action="store_true", help="validate without writing")
    args = parser.parse_args()

    files = args.files or sorted(GRADES_DIR.glob("graded-*.json"))
    if not files:
        sys.exit(f"no graded files — expected {GRADES_DIR}/graded-*.json "
                 "(run scripts.grade_queue, then the grade-players skill)")

    conn = db.connect()
    db.init(conn, quiet=True)
    if not conn.execute("SELECT 1 FROM players LIMIT 1").fetchone():
        sys.exit("no players in the cache — run load_players first")

    index = player_index(conn)
    total, rejected = 0, 0

    for path in files:
        count, errors = load_file(path, conn, index, args.dry_run)
        if errors:
            rejected += 1
            print(f"  {path.name}: rejected, {len(errors)} problem(s)")
            for error in errors[:10]:
                print(f"    {error}")
            if len(errors) > 10:
                print(f"    ... and {len(errors) - 10} more")
            continue
        total += count
        print(f"  {path.name}: {count} grade(s){' (dry run)' if args.dry_run else ''}")

    conn.commit()
    graded = conn.execute("SELECT COUNT(*) FROM player_grades").fetchone()[0]
    print(f"{total} grade(s) from {len(files) - rejected}/{len(files)} file(s); "
          f"{graded} in the table")
    conn.close()


if __name__ == "__main__":
    main()
