"""What each available player is worth to us, right now.

    python3 -m value                          # the default league's live draft
    python3 -m value --league <id> --draft <id>
    python3 -m value --plan                   # what to take now vs. what to wait on

The board sorts by ADP, which is what the rest of the league thinks. This is
what *we* think, and it differs for three reasons: it prices a player against
the lineup we already hold, against the baseline his position can actually be
replaced at, and against what waiting until our next pick would get us instead.

docs/value-formula.md works through why, with the numbers. The short version:

  value = gain(player) - cost(position) + upside(round)

where `gain` is what he adds to the best legal starting lineup across a whole
17-week season, and `cost` is what spending this pick on his position does to
the rest of the draft — the best plan we have, less what is left after taking
him. So the top of the board sits at zero and everything below it is regret,
in points, against the best line available.

That makes the board and `--plan` the same search read two ways. They used to
be different calculations, and duly disagreed: at pick 49 the board wanted a
tight end the plan had twenty points behind a running back. Ranking a single
pick on what a position is worth *now* flatters a thin one, because scarcity
gets credited without the deep positions still to fill ever being charged for.
"""

from __future__ import annotations

import argparse
import json
import math
import sqlite3
from collections import Counter
from dataclasses import dataclass

import db

SEASON_GAMES = 17

# Positions a FLEX slot accepts.
FLEXABLE = frozenset({"RB", "WR", "TE"})

# The only two positions that can genuinely be refilled off waivers week to
# week. It shows in the data: the gap between the last starting kicker and the
# best one left after the draft is 0 points, and for a defense it is 1 — where
# for a running back it is 102. That difference is what the baselines below
# turn on, and it decides more of the ranking than any other single number.
STREAMABLE = frozenset({"K", "DEF"})

# Minimum bodies to carry, whatever the starting slots alone imply. An
# expected-value model averages injuries out; a season does not. You cannot
# cover a mandatory RB slot with a receiver, so depth at the positions we must
# start is not optional. This is judgment rather than measurement — without it
# the model preferred a fourth receiver to a third back by 4.1 points, so it
# was nearly indifferent and the floor buys the insurance cheaply.
DEPTH = {"RB": 3, "WR": 3, "QB": 1, "TE": 1, "K": 1, "DEF": 1}

# How far a -2..+2 context grade moves a projection. Deliberately small: we are
# correcting a provider's number, not replacing it with our own.
OFFENSE_WEIGHT = 0.05
SUPPORT_WEIGHT = 0.04

# How much of a player's season an ungraded starter is assumed to be available
# for. Only used as a fallback — a graded player uses his own exp_games, which
# is the whole point of grading. player_projections.gp cannot be used for this:
# it is 18.0 for every player who has one.
DEFAULT_AVAILABILITY = {"QB": .88, "RB": .79, "WR": .85, "TE": .82, "K": .97, "DEF": 1.0}

# Upside is the right tail, and what it is worth depends on when we're picking.
# An early pick is bought for its floor — we need those points every week. A
# late pick is a lottery ticket against a bench slot, where the downside is a
# player we drop in October, so the tail is the only part worth paying for.
UPSIDE_STEP = 0.035
UPSIDE_FULL_ROUND = 12

# ADP is a mean and players go in a range around it. Sleeper publishes no
# spread, so this is assumed, and it is the least evidenced number in the file:
# it drives every `wait`. Measuring it from repeated mock drafts would be
# strictly better than guessing.
ADP_SPREAD = 0.15
ADP_SPREAD_FLOOR = 4.0


@dataclass
class Player:
    """One draftable player, priced for a particular league."""

    player_id: str
    name: str
    position: str
    team: str | None
    adp: float
    points: float                       # projected, under this league's scoring
    availability: float                 # share of the season he'll be there for
    offense: int = 0
    support: int = 0
    upside: int = 0
    graded: bool = False

    @property
    def adjusted(self) -> float:
        """Season points if he played every week, corrected for context.

        Deliberately *not* scaled by availability. The games he misses are
        priced once, in `lineup`, where they fall through to whoever is next at
        his position — scaling here as well would charge for them twice.
        """
        return self.points * (1 + OFFENSE_WEIGHT * self.offense + SUPPORT_WEIGHT * self.support)


def load_pool(conn: sqlite3.Connection, league_id: str, season: str | None = None) -> list[Player]:
    """Every player with an ADP and a projection, priced for this league."""
    league = conn.execute("SELECT * FROM leagues WHERE league_id = ?", (league_id,)).fetchone()
    if league is None:
        raise LookupError(f"league {league_id} isn't in the cache")
    season = season or league["season"]

    points = db.projected_points(conn, league_id, season)
    adp_column = db.adp_column(league["scoring_type"])

    pool = []
    for row in conn.execute(
        f"""SELECT p.player_id, p.full_name, p.position, p.team, pr.{adp_column} AS adp,
                   g.offense, g.support, g.exp_games, g.upside
              FROM players p
              JOIN player_projections pr ON pr.player_id = p.player_id AND pr.season = ?
              LEFT JOIN player_grades g ON g.player_id = p.player_id AND g.season = ?
             WHERE pr.{adp_column} IS NOT NULL AND pr.{adp_column} < 999""",
        (season, season),
    ):
        # A player with an ADP but no stat line is deep bench filler. Scoring
        # him zero would rank him below replacement rather than omitting him.
        if row["player_id"] not in points:
            continue
        graded = row["exp_games"] is not None
        pool.append(Player(
            player_id=row["player_id"],
            name=row["full_name"],
            position=row["position"],
            team=row["team"],
            adp=row["adp"],
            points=points[row["player_id"]],
            availability=(row["exp_games"] / SEASON_GAMES if graded
                          else DEFAULT_AVAILABILITY.get(row["position"], 0.85)),
            offense=row["offense"] or 0,
            support=row["support"] or 0,
            upside=row["upside"] or 0,
            graded=graded,
        ))
    return pool


def roster_slots(conn: sqlite3.Connection, league_id: str) -> list[str]:
    row = conn.execute("SELECT roster_positions FROM leagues WHERE league_id = ?",
                       (league_id,)).fetchone()
    return json.loads(row["roster_positions"]) if row and row["roster_positions"] else []


def baselines(pool: list[Player], teams: int, rounds: int) -> dict[str, float]:
    """What an unfilled slot at each position is really worth.

    Streamable positions get the last starter, because a top-12 kicker is
    always a waiver claim away. Everything else gets the best player left once
    the draft is over, which is what the wire actually offers — for a running
    back that is a hundred points worse than the last starter, and assuming
    otherwise makes a receiver-only draft look optimal when it isn't.
    """
    drafted = teams * rounds
    out: dict[str, float] = {}
    for position in {p.position for p in pool}:
        ranked = sorted((p.adjusted for p in pool if p.position == position), reverse=True)
        if not ranked:
            continue
        if position in STREAMABLE:
            out[position] = ranked[min(teams, len(ranked)) - 1]
        else:
            taken = sum(1 for p in pool if p.position == position and p.adp <= drafted)
            out[position] = ranked[min(taken, len(ranked) - 1)]
    return out


def _slot_demand(slots: list[str]) -> tuple[dict[str, float], float]:
    """Slot-seasons each position owes, and the FLEX seasons anyone can cover.

    The FLEX is deliberately *not* handed to a position here. Doing that made
    an unfilled slot collect whichever baseline was highest — a free waiver
    tight end, in this league — which is worth more than a real receiver, so
    every receiver on the board priced at exactly 0.0. A FLEX is one slot that
    several positions can fill, so it is carried as its own demand and settled
    in `_coverage` against whoever is actually spare.
    """
    need: dict[str, float] = {}
    for slot in (s for s in slots if s not in ("BN", "FLEX")):
        need[slot] = need.get(slot, 0) + 1
    for position, floor in DEPTH.items():
        if position in need:
            need[position] = max(need[position],
                                 floor * DEFAULT_AVAILABILITY.get(position, 0.85))
    return need, float(sum(1 for s in slots if s == "FLEX"))


def wire(base: dict[str, float]) -> float:
    """What an unfilled FLEX is worth: the best of the positions it accepts.

    An empty FLEX is not empty in practice — we stream the best flexable player
    on the wire into it. That is a genuinely higher floor than any single
    position's, which is exactly why the slot must not be allowed to compete
    with our own players for the spot.
    """
    return max((base[position] for position in FLEXABLE if position in base), default=0.0)


def _coverage(roster: list[Player], need: dict[str, float], flex: float,
              base: dict[str, float]) -> float:
    """Season points this roster covers against a given demand.

    A player covers only the share of the season he is available for, so the
    games his starters miss fall to the next man at that position, and to the
    waiver wire if there isn't one.

    Positions are settled first and the FLEX last, out of whatever weeks are
    left over. Best-first at both steps is optimal rather than merely
    convenient: the FLEX floor is the best of the flexable baselines, so it is
    never below a position's, and a player is therefore always worth at least
    as much in his own slot as in the FLEX.

    No week is ever worth less than the wire. We would not start a player worse
    than the best man available at his position, so a covered week is worth the
    better of the two. Without that floor a sub-replacement player *displaces*
    the waiver option and lowers the roster by taking a spot — which is how a
    25-point receiver came to cost 60 points, and how `gain` came to be
    something a player could be punished for.
    """
    total = 0.0
    spare: list[tuple[float, float]] = []       # (adjusted, weeks) left for the FLEX
    positions = set(need) | {p.position for p in roster if p.position in FLEXABLE}
    for position in positions:
        floor = base.get(position, 0.0)
        remaining = float(need.get(position, 0.0))
        mine = sorted((p for p in roster if p.position == position), key=lambda p: -p.adjusted)
        for player in mine:
            covered = min(player.availability, remaining)
            total += covered * max(player.adjusted, floor)
            remaining -= covered
            if player.availability > covered and position in FLEXABLE:
                spare.append((player.adjusted, player.availability - covered))
        total += remaining * floor

    floor = wire(base)
    remaining = flex
    for adjusted, weeks in sorted(spare, reverse=True):
        covered = min(weeks, remaining)
        total += covered * max(adjusted, floor)
        remaining -= covered
    return total + remaining * floor


def lineup(roster: list[Player], slots: list[str], base: dict[str, float]) -> float:
    """Season points from the best legal lineup this roster can field.

    Every starting slot needs all seventeen weeks, and depth is what covers the
    ones a starter misses — a third running back is not a spare, he is the man
    who plays the games the first two are out for.
    """
    need, flex = _slot_demand(slots)
    return _coverage(roster, need, flex, base)


def gain(player: Player, roster: list[Player], slots: list[str], base: dict[str, float]) -> float:
    """What this player adds to the lineup we already hold.

    Never negative: a player we can leave on the bench cannot make the roster
    worse, so noise around a zero-value pick should not read as a reason to
    avoid him.
    """
    return max(0.0, lineup(roster + [player], slots, base) - lineup(roster, slots, base))


def survival(adp: float, pick: int) -> float:
    """Rough chance a player is still on the board at `pick`.

    A smooth function of how far past his ADP the pick is, not a cutoff: ADP is
    a mean, and the spread around it is what decides whether waiting is a real
    option or a bet. See ADP_SPREAD — this is the assumed part of the model.
    """
    if adp is None or adp >= 999:
        return 1.0
    sigma = max(ADP_SPREAD_FLOOR, ADP_SPREAD * adp)
    return 0.5 * math.erfc((pick - adp) / sigma / math.sqrt(2))


def wait(position: str, pool: list[Player], pick: int, roster: list[Player],
         slots: list[str], base: dict[str, float], depth: int = 40) -> tuple[float, Player | None]:
    """Expected gain from the best player at `position` still there at `pick`.

    Walks the position best-first: each player contributes his gain weighted by
    the chance he lasts, times the chance everyone better than him did not.
    Also returns the player we'd most likely end up with, which is what makes
    the plan search below able to carry a roster forward.
    """
    ranked = sorted(((gain(p, roster, slots, base), p) for p in pool if p.position == position),
                    key=lambda pair: -pair[0])[:depth]
    expected, still_gone, likely, best = 0.0, 1.0, None, 0.0
    for value, player in ranked:
        chance = survival(player.adp, pick)
        # The chance this is the one we actually end up with: he lasts, and
        # nobody better did. That is also what makes him the right player to
        # carry forward into a plan — the best player at the position is not,
        # since by definition he is the least likely to still be there.
        mine = still_gone * chance
        expected += mine * value
        if mine > best:
            best, likely = mine, player
        still_gone *= (1 - chance)
    return expected, (likely or (ranked[0][1] if ranked else None))


def upside_bonus(player: Player, round_no: int, got: float) -> float:
    """What the right tail is worth at this point in the draft.

    Scaled by what he'd actually add, not by what he'd score. Upside on a
    player with no route into the lineup is worth nothing — without this a
    backup quarterback collects a bonus for a breakout he would never get the
    chance to have, which is how a simulated draft ended up taking five of them.

    Nothing is subtracted for risk: the downside is already priced, because a
    fragile player's `availability` hands his missed games to the next man in
    `lineup`. Charging for it again here would be counting it twice.
    """
    weight = UPSIDE_STEP * min(round_no, UPSIDE_FULL_ROUND) / UPSIDE_FULL_ROUND
    return player.upside * weight * got


def our_picks(draft: sqlite3.Row, user_ids: set[str]) -> list[int]:
    """Every pick number we own, in order.

    Derived from the draft's own order rather than written down: the slot plus
    teams, rounds and type is enough. A draft whose order isn't set yet has no
    answer, so it returns nothing rather than guessing.
    """
    if not draft["draft_order"]:
        return []
    order = json.loads(draft["draft_order"])
    slot = next((s for user_id, s in order.items() if user_id in user_ids), None)
    if slot is None:
        return []

    teams, rounds = draft["teams"], draft["rounds"]
    reversal = draft["reversal_round"] or 0
    picks = []
    for round_no in range(1, rounds + 1):
        forward = round_no % 2 == 1
        if reversal and round_no >= reversal:
            forward = not forward
        if draft["type"] == "linear":
            forward = True
        picks.append((round_no - 1) * teams + (slot if forward else teams - slot + 1))
    return picks


def draft_state(conn: sqlite3.Connection, draft_id: str,
                user_ids: set[str]) -> tuple[set[str], set[str], int]:
    """Who's gone, who's ours, and which pick is next.

    A pick with no `picked_by` is an autopick, so it counts as gone rather than
    as ours — same rule the board uses.
    """
    gone, ours = set(), set()
    count = 0
    for row in conn.execute(
        "SELECT player_id, picked_by FROM draft_picks WHERE draft_id = ?", (draft_id,)
    ):
        count += 1
        if not row["player_id"]:
            continue
        gone.add(row["player_id"])
        if row["picked_by"] and row["picked_by"] in user_ids:
            ours.add(row["player_id"])
    return gone, ours, count + 1


def must_fill(roster: list[Player], slots: list[str], picks_left: int) -> set[str]:
    """Positions we have to spend our last picks on to field a legal lineup.

    Legality, not value. A kicker is worth ~0 to take at any point — the twelfth
    best projects within a few points of the first, so `wait` correctly says
    there is never a reason to hurry. Left alone that logic never takes one at
    all, and a roster with no kicker cannot field a lineup no matter how good
    the rest of it is. So once the picks remaining are down to the slots still
    empty, those slots are the only thing on the board.
    """
    needed = Counter(s for s in slots if s not in ("BN", "FLEX"))
    have = Counter(p.position for p in roster)
    short = {position: count - have.get(position, 0) for position, count in needed.items()}
    short = {position: n for position, n in short.items() if n > 0}
    return set(short) if picks_left <= sum(short.values()) else set()


# How many of our upcoming picks to plan over, and the positions worth planning
# with. Four picks is often only two turns — a snake turn is frequently two
# back-to-back picks — and the prior art is clear that looking deeper than that
# buys almost nothing. K and DEF are deliberately absent: they are flat across
# the whole draft, so they never belong in the middle of a plan, though they are
# still priced as a *first* pick like anything else.
PLAN_AHEAD = 4
PLAN_POSITIONS = ("RB", "WR", "TE", "QB")


@dataclass
class Situation:
    """The draft as it stands, and everything pricing a pick needs.

    Shared so the board and the plan can't drift: they used to build this
    separately, which is exactly how they came to disagree about tight ends.
    """

    slots: list[str]
    base: dict[str, float]
    roster: list[Player]
    available: list[Player]
    upcoming: list[int]
    at_pick: int
    round_no: int


def situation(conn: sqlite3.Connection, league_id: str, draft_id: str) -> Situation:
    """Read the draft and price the pool against the roster we hold."""
    draft = conn.execute("SELECT * FROM drafts WHERE draft_id = ?", (draft_id,)).fetchone()
    if draft is None:
        raise LookupError(f"draft {draft_id} isn't in the cache")

    user_ids = {u["user_id"] for u in db.tracked_users(conn) if u["user_id"]}
    gone, ours, at_pick = draft_state(conn, draft_id, user_ids)
    pool = load_pool(conn, league_id)
    return Situation(
        slots=roster_slots(conn, league_id),
        base=baselines(pool, draft["teams"], draft["rounds"]),
        roster=[p for p in pool if p.player_id in ours],
        available=[p for p in pool if p.player_id not in gone],
        upcoming=[p for p in our_picks(draft, user_ids) if p >= at_pick],
        at_pick=at_pick,
        round_no=math.ceil(at_pick / draft["teams"]) if draft["teams"] else 1,
    )


def _continuation(picks: list[int], roster: list[Player], available: list[Player],
                  slots: list[str], base: dict[str, float],
                  positions: tuple[str, ...] = PLAN_POSITIONS) -> tuple[float, list]:
    """Best total gain over `picks`, and who we'd expect to end up with.

    Recursive rather than an enumeration of whole sequences, so every prefix is
    priced once instead of once per sequence that starts with it — the same 256
    plans for a third of the work.

    The roster grows as it goes, which is the entire point: a plan that scores
    each pick against the roster we hold today is not a plan, because by the
    third pick it is pricing against a roster we won't have.
    """
    if not picks:
        return 0.0, []
    options = []
    for position in positions:
        got, player = wait(position, available, picks[0], roster, slots, base)
        if player is None:
            continue
        rest, taken = _continuation(
            picks[1:], roster + [player],
            [p for p in available if p.player_id != player.player_id],
            slots, base, positions)
        options.append((got + rest, [(picks[0], player)] + taken))
    if not options:
        return 0.0, []
    return max(options, key=lambda option: option[0])


def outlook(sit: Situation, candidates: list[Player], gains: dict[str, float],
            ahead: int = PLAN_AHEAD) -> tuple[dict[str, float], float]:
    """What the rest of the draft is worth after spending this pick on each position.

    Returns the continuation value per position and the best whole plan going.
    Spending the pick on a position costs us `best - continuation[position]`,
    and that is what the board ranks on: not what a position is worth now, but
    what taking it now does to everything that follows.
    """
    picks = sit.upcoming[:ahead]
    rest_of, best = {}, 0.0
    for position in {p.position for p in candidates}:
        got, player = max(((gains[p.player_id], p) for p in candidates
                           if p.position == position), key=lambda pair: pair[0])
        rest_of[position], _ = _continuation(
            picks[1:], sit.roster + [player],
            [p for p in sit.available if p.player_id != player.player_id],
            sit.slots, sit.base)
        best = max(best, got + rest_of[position])
    return rest_of, best


@dataclass
class Ranked:
    player: Player
    value: float
    gain: float
    cost: float
    bonus: float


def board(conn: sqlite3.Connection, league_id: str, draft_id: str,
          limit: int = 200, ahead: int = PLAN_AHEAD) -> tuple[list[Ranked], list[Player], list[int]]:
    """Rank what's left by what it's worth to us at the pick we're on.

    Value is regret against the best plan we have: zero at the top of the
    board, and negative by however much taking that player instead costs the
    rest of the draft.

        value(i) = gain(i) - cost(position) + upside(i)
        cost(pos) = best plan going - what's left after spending this pick on pos

    The board and `plans` are the same search read two ways, which they have to
    be — ranking one pick on `gain - wait` and the draft on a plan had them
    disagreeing by twenty points about whether to take a tight end at 49. The
    one-pick version flatters a thin position, because it credits scarcity
    without ever charging for the deep positions still to fill.
    """
    sit = situation(conn, league_id, draft_id)

    forced = must_fill(sit.roster, sit.slots, len(sit.upcoming))
    pickable = [p for p in sit.available if p.position in forced] if forced else sit.available
    candidates = sorted(pickable, key=lambda p: p.adp)[:limit]

    gains = {p.player_id: gain(p, sit.roster, sit.slots, sit.base) for p in candidates}
    rest_of, best = outlook(sit, candidates, gains, ahead)

    ranked = []
    for player in candidates:
        got = gains[player.player_id]
        bonus = upside_bonus(player, sit.round_no, got)
        cost = best - rest_of[player.position]
        ranked.append(Ranked(player, got - cost + bonus, got, cost, bonus))
    ranked.sort(key=lambda r: -r.value)
    return ranked, sit.roster, sit.upcoming


def plans(conn: sqlite3.Connection, league_id: str, draft_id: str, ahead: int = PLAN_AHEAD,
          positions: tuple[str, ...] = PLAN_POSITIONS) -> list[tuple[float, tuple, list]]:
    """The best plan starting with each position, best first.

    This is what answers "take a back now, or wait a round?" — and it is the
    same search `board` ranks on, so the two cannot disagree. What it adds is
    the reasoning: which players it expects to get, and in what order.
    """
    sit = situation(conn, league_id, draft_id)
    picks = sit.upcoming[:ahead]
    if not picks:
        return []

    scored = []
    for position in positions:
        options = [(gain(p, sit.roster, sit.slots, sit.base), p)
                   for p in sit.available if p.position == position]
        if not options:
            continue
        got, player = max(options, key=lambda pair: pair[0])
        rest, taken = _continuation(
            picks[1:], sit.roster + [player],
            [p for p in sit.available if p.player_id != player.player_id],
            sit.slots, sit.base, positions)
        plan = [(picks[0], player)] + taken
        scored.append((got + rest, tuple(pick.position for _, pick in plan), plan))
    scored.sort(key=lambda row: -row[0])
    return scored


def default_target(conn: sqlite3.Connection) -> tuple[str, str]:
    """The league and draft to use when none is named."""
    row = conn.execute(
        """SELECT l.league_id, d.draft_id FROM leagues l
             JOIN drafts d ON d.league_id = l.league_id
            ORDER BY d.status = 'drafting' DESC, d.start_time
            LIMIT 1"""
    ).fetchone()
    if row is None:
        raise LookupError("no league with a draft in the cache — run scripts.load_all")
    return row["league_id"], row["draft_id"]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--league", help="league_id (default: the first with a draft)")
    parser.add_argument("--draft", help="draft_id (default: that league's draft)")
    parser.add_argument("--top", type=int, default=15, help="how many players to show")
    parser.add_argument("--plan", action="store_true",
                        help="compare position orders over the next few picks")
    parser.add_argument("--ahead", type=int, default=PLAN_AHEAD,
                        help="picks to plan over")
    args = parser.parse_args()

    conn = db.connect()
    db.init(conn, quiet=True)

    league_id, draft_id = args.league, args.draft
    if not league_id or not draft_id:
        found_league, found_draft = default_target(conn)
        league_id, draft_id = league_id or found_league, draft_id or found_draft

    league = conn.execute("SELECT name, scoring_type FROM leagues WHERE league_id = ?",
                          (league_id,)).fetchone()
    ranked, roster, upcoming = board(conn, league_id, draft_id, limit=250)

    graded = sum(1 for r in ranked if r.player.graded)
    print(f"{league['name']} ({league['scoring_type']})")
    print(f"  our picks: {', '.join(str(p) for p in upcoming[:6])}"
          f"{' ...' if len(upcoming) > 6 else ''}")
    print(f"  roster:    {', '.join(p.name for p in roster) or 'empty'}")
    print(f"  graded:    {graded} of {len(ranked)} shown")

    if args.plan:
        scored = plans(conn, league_id, draft_id, ahead=args.ahead)
        if not scored:
            print("\n  no picks left to plan")
            return
        over = ", ".join(str(pick) for pick, _ in scored[0][2])
        best = scored[0][0]
        print(f"\n  best plan starting with each position, over picks {over}:")
        for total, sequence, taken in scored:
            who = " -> ".join(player.name for _, player in taken)
            print(f"    {sequence[0]:4} {total:8.1f} {total - best:+7.1f}  "
                  f"{'/'.join(sequence):16}  {who}")
        return

    print(f"\n  {'value':>7} {'gain':>7} {'cost':>7} {'up':>5}  {'pos':4} {'adp':>6}  player")
    for row in ranked[:args.top]:
        flag = " " if row.player.graded else "?"
        print(f"  {row.value:7.1f} {row.gain:7.1f} {row.cost:7.1f} {row.bonus:5.1f}  "
              f"{row.player.position:4} {row.player.adp:6.1f}  {row.player.name}{flag}")
    conn.close()


if __name__ == "__main__":
    main()
