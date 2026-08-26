"""Matching a written-down player name against the players table.

Grades come back from research as names, and Sleeper stores names its own way:
no suffix ("Brian Robinson", never "Brian Robinson Jr."), and inconsistent
punctuation. Normalizing both sides is what makes the match exact rather than
fuzzy — a guessy matcher on a draft board is worse than one that says it can't
tell, because a wrong id silently grades the wrong player.
"""

from __future__ import annotations

import re
import sqlite3

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
