"""Properties the value model has to hold.

    python3 -m scripts.check_coverage

The board and `--plan` must agree, and adding a player must never lower the
lineup. Two separate things have broken
that before — a greedy FLEX choice, and a sub-replacement player displacing the
waiver option — and both showed up as negative gains, which make `wait` negative
and inflate whoever caused it. Worth running any time `_coverage` is touched.
"""

from __future__ import annotations

import argparse
import random

import db
import value


def check_coverage(league_id: str, trials: int, seed: int) -> int:
    conn = db.connect()
    db.init(conn, quiet=True)
    pool = value.load_pool(conn, league_id)
    slots = value.roster_slots(conn, league_id)
    draft = conn.execute(
        "SELECT teams, rounds FROM drafts WHERE league_id = ? LIMIT 1", (league_id,)
    ).fetchone()
    base = value.baselines(pool, draft["teams"], draft["rounds"])

    rng = random.Random(seed)
    failures = 0
    for _ in range(trials):
        roster = rng.sample(pool, rng.randint(0, 14))
        player = rng.choice([p for p in pool if p not in roster])
        before = value.lineup(roster, slots, base)
        after = value.lineup(roster + [player], slots, base)
        if after < before - 1e-9:
            failures += 1
            if failures <= 5:
                print(f"  non-monotone: adding {player.name} ({player.position}, "
                      f"adj {player.adjusted:.1f}) took {before:.2f} -> {after:.2f}")
                print("    roster:", ", ".join(f"{p.position} {p.name}" for p in roster))
    print(f"monotonicity: {trials - failures}/{trials} clean")

    # Anyone better than the wire must be worth something in an open FLEX.
    # This is the failure that zeroed every receiver on a live board. Position
    # demand has to be saturated first — fill to the depth floors, so the only
    # place a further player can go is the FLEX — and then an unfilled slot
    # collecting the best position baseline for free prices a receiver
    # comfortably above replacement at exactly 0.0.
    from collections import Counter
    bodies = Counter(s for s in slots if s not in ("BN", "FLEX"))
    for position, floor in value.DEPTH.items():
        bodies[position] = max(bodies[position], floor)
    filled = []
    for position, count in bodies.items():
        best = sorted((p for p in pool if p.position == position),
                      key=lambda p: -p.adjusted)[:count]
        filled.extend(best)
    wire = max(base[p] for p in value.FLEXABLE if p in base)
    spare = [p for p in sorted(pool, key=lambda p: p.adp)[:150]
             if p.position in value.FLEXABLE and p not in filled and p.adjusted > wire]
    dead = [p for p in spare if value.gain(p, filled, slots, base) <= 1e-9]
    print(f"flex is fillable: {len(spare) - len(dead)}/{len(spare)} above-wire players "
          f"worth something (wire {wire:.1f})")
    for player in dead[:6]:
        print(f"  DEAD {player.position} {player.name:22} adj {player.adjusted:6.1f} "
              f"-> flex gain 0.0")
    worse = len(dead)
    conn.close()
    return failures + worse


def check_team_offense(season: str = "2026") -> int:
    """`offense` is a team tier, so teammates cannot disagree about it.

    It grades the offense a player plays in — scoring drives, red-zone trips,
    pace — which is a property of the team and not of the player. Graded
    per-player it drifted badly: 23 of 32 teams once had teammates on different
    numbers, New England carrying +2, +1 and 0 at the same time. This is
    mechanical rather than a judgement, so it is worth asserting.
    """
    conn = db.connect()
    db.init(conn, quiet=True)
    rows = conn.execute(
        """SELECT p.team, g.offense FROM player_grades g
             JOIN players p ON p.player_id = g.player_id
            WHERE g.season = ? AND p.team IS NOT NULL AND g.offense IS NOT NULL""",
        (season,)).fetchall()
    conn.close()

    grades: dict[str, set[int]] = {}
    for row in rows:
        grades.setdefault(row["team"], set()).add(row["offense"])
    split = {team: sorted(seen) for team, seen in grades.items() if len(seen) > 1}
    for team, seen in sorted(split.items()):
        print(f"  SPLIT {team}: teammates graded {seen}")
    print(f"one offense grade per team: {len(grades) - len(split)}/{len(grades)} teams clean")
    return len(split)


def check_agreement(league_id: str, draft_id: str) -> int:
    """The board and the plan are one search, so they cannot rank differently.

    `value` is regret against the best plan going, so the best player at each
    position must score exactly that position's plan delta. These were separate
    calculations once and drifted twenty points apart on whether to take a
    tight end.
    """
    conn = db.connect()
    db.init(conn, quiet=True)
    ranked, _, _ = value.board(conn, league_id, draft_id, limit=250)
    scored = value.plans(conn, league_id, draft_id)
    conn.close()
    if not scored:
        print("agreement: no picks left to plan, skipped")
        return 0

    best = scored[0][0]
    bad = 0
    for total, sequence, _ in scored:
        top = max((r for r in ranked if r.player.position == sequence[0]),
                  key=lambda r: r.value, default=None)
        if top is None:
            continue
        board_says, plan_says = top.value, total - best
        ok = abs(board_says - plan_says) < 1e-6
        bad += not ok
        print(f"  {'ok  ' if ok else 'DIFF'} {sequence[0]:4} board {board_says:+8.2f}   "
              f"plan {plan_says:+8.2f}   ({top.player.name})")
    print(f"board agrees with plan: {len(scored) - bad}/{len(scored)} positions")
    return bad


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--league", help="league_id (default: the first with a draft)")
    parser.add_argument("--draft", help="draft_id (default: that league's draft)")
    parser.add_argument("--trials", type=int, default=1000)
    parser.add_argument("--seed", type=int, default=0)
    args = parser.parse_args()

    league_id, draft_id = args.league, args.draft
    if not league_id or not draft_id:
        conn = db.connect()
        found_league, found_draft = value.default_target(conn)
        conn.close()
        league_id, draft_id = league_id or found_league, draft_id or found_draft

    bad = check_coverage(league_id, args.trials, args.seed)
    bad += check_team_offense()
    bad += check_agreement(league_id, draft_id)
    raise SystemExit(1 if bad else 0)


if __name__ == "__main__":
    main()
