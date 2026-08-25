"""Write the list of players that need grading, split into batches.

    python3 -m scripts.grade_queue                  # top 200, batches of 25
    python3 -m scripts.grade_queue --top 120 --batch 20
    python3 -m scripts.grade_queue --regrade        # include players already graded

Grades are researched by hand (see .claude/skills/grade-players), and research
is the expensive part, so this decides what is worth researching at all.

Two filters do that. Only the top players by ADP matter — below them the
replacement baseline has flattened the differences to under a point, so a grade
can't change a decision. And kickers and defenses are skipped outright: they're
the only streamable positions, their value is flat across the whole draft, and
no amount of context changes that.

Batches are written one file each so they can be researched in parallel and
loaded independently — a batch that comes back wrong is re-run on its own.
"""

from __future__ import annotations

import argparse
import json
import pathlib

import db

QUEUE_DIR = pathlib.Path("data/grades")

# The two positions worth no research: they can be refilled off waivers every
# week, so the gap between the last starter and the wire is ~0 points.
SKIP_POSITIONS = ("K", "DEF")


def adp_columns(conn) -> list[str]:
    """The ADP columns the tracked leagues actually rank on."""
    types = [r["scoring_type"] for r in conn.execute("SELECT DISTINCT scoring_type FROM leagues")]
    return sorted({db.adp_column(t) for t in types}) or ["adp_half_ppr"]


def candidates(conn, season: str, top: int, regrade: bool) -> list[dict]:
    """The top `top` players by ADP that still need a grade.

    Ranked on the best ADP across every format in play, so a player who goes
    early in either league is researched for both.
    """
    cols = adp_columns(conn)
    best = "MIN(" + ", ".join(f"COALESCE(pr.{c}, 999)" for c in cols) + ")" if len(cols) > 1 \
        else f"COALESCE(pr.{cols[0]}, 999)"
    skip = ", ".join("?" * len(SKIP_POSITIONS))
    having = "" if regrade else "AND g.player_id IS NULL"
    rows = conn.execute(
        f"""SELECT p.player_id, p.full_name, p.position, p.team, p.age, p.years_exp,
                   p.injury_status, p.depth_chart_order, {best} AS adp
              FROM players p
              JOIN player_projections pr ON pr.player_id = p.player_id AND pr.season = ?
              LEFT JOIN player_grades g ON g.player_id = p.player_id AND g.season = ?
             WHERE p.position NOT IN ({skip})
               AND {best} < 999
               {having}
             ORDER BY adp
             LIMIT ?""",
        (season, season, *SKIP_POSITIONS, top),
    ).fetchall()
    return [dict(r) for r in rows]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--season", default="2026")
    parser.add_argument("--top", type=int, default=200, help="how many players to grade")
    parser.add_argument("--batch", type=int, default=25, help="players per batch file")
    parser.add_argument("--regrade", action="store_true",
                        help="include players that already have a grade")
    parser.add_argument("--out", type=pathlib.Path, default=QUEUE_DIR)
    args = parser.parse_args()

    conn = db.connect()
    db.init(conn, quiet=True)

    players = candidates(conn, args.season, args.top, args.regrade)
    if not players:
        print("nothing to grade — every player in range already has a grade "
              "(use --regrade to redo them)")
        return

    args.out.mkdir(parents=True, exist_ok=True)
    for old in args.out.glob("queue-*.json"):
        old.unlink()

    batches = [players[i:i + args.batch] for i in range(0, len(players), args.batch)]
    for n, batch in enumerate(batches, 1):
        path = args.out / f"queue-{n:02d}.json"
        path.write_text(json.dumps({"season": args.season, "batch": n, "players": batch}, indent=2))
        span = f"{batch[0]['adp']:.0f}-{batch[-1]['adp']:.0f}"
        print(f"  {path}  {len(batch)} players, adp {span}")

    print(f"{len(players)} player(s) to grade in {len(batches)} batch(es)")
    conn.close()


if __name__ == "__main__":
    main()
