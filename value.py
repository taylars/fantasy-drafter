"""What each available player is worth to us, right now.

    python3 -m value                          # the default league's live draft
    python3 -m value --league <id> --draft <id>
    python3 -m value --plan                   # what to take now vs. what to wait on

The board sorts by ADP, which is what the rest of the league thinks. This is
what *we* think, and it differs for three reasons: it prices a player against
the lineup we already hold, against the baseline his position can actually be
replaced at, and against what waiting until our next pick would get us instead.

docs/value-formula.md works through why, with the numbers. The short version:

  value = gain(player) - cost(position)

where `gain` is what he adds to the best legal starting lineup across a whole
17-week season — his projection first corrected for the context the provider
cannot see — and `cost` is what spending this pick on his position does to
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
#
# `position_security` replaced a `support` grade that asked two questions at
# once — how good the situation is, and how secure the role is — and so
# double-counted the first against `offense`. It now asks only the second. The
# A maximum +2/+2 context stack moves the provider projection by 9%. Larger
# weights let contextual judgment overwhelm meaningful projection gaps — for
# example, they once lifted Jadarian Price above Bucky Irving and David
# Montgomery despite Price's substantially lower provider projection.
OFFENSE_WEIGHT = 0.025
SECURITY_WEIGHT = 0.02

# How much of a player's season an ungraded starter is assumed to be available
# for. Only used as a fallback — a graded player uses his own exp_games, which
# is the whole point of grading. player_projections.gp cannot be used for this:
# it is 18.0 for every player who has one.
DEFAULT_AVAILABILITY = {"QB": .88, "RB": .79, "WR": .85, "TE": .82, "K": .97, "DEF": 1.0}

# A healthy starting quarterback is unusually durable. Grade notes can still
# explain why a projection is lower, but historical injuries should not make a
# current QB1 a projected 13-game player unless the player feed says he is
# presently injured. Backups are deliberately excluded: their low expected
# games describe role, not durability. A stale depth chart can occasionally
# label a backup QB1, so the player must also project for a starter's workload.
HEALTHY_QB_FLOOR_GAMES = 15.0
CURRENT_INJURY_STATUSES = frozenset({"Questionable", "Doubtful", "Out", "IR",
                                     "Injured Reserve", "PUP", "Suspended"})

# Room above the projection. This is a correction to the mean, not a premium
# for variance: the three things that earn the grade — a second-year jump the
# provider smooths out, a path to work behind a fragile starter, a touchdown
# role a yardage model understates — are all reasons the projected number is
# too low, and a mixture over a role that might open has a higher mean too.
#
# So it is flat. It used to scale with the round, on the theory that a late
# pick is a lottery ticket and only the tail is worth buying; but a projection
# that is 3.5% light is 3.5% light in the first round as well. Together with
# offense and security, the most favorable +2/+2/+2 grade can correct a
# projection upward by 12.5%, enough to matter without replacing it.
UPSIDE_WEIGHT = 0.0175

# A bench player has option value even when the mean projection does not crack
# today's best lineup.  Upside is the reason to spend a late pick on that
# outcome: +1 is worth 10 season points and +2 is worth 20.  A small share of
# above-wire production breaks ties between players with the same upside.
# This term applies only after the roster can already field every starting
# slot, so it cannot inflate a player being drafted to fill the lineup.
BENCH_OPTION_WEIGHT = 0.02
BENCH_UPSIDE_POINTS = 10.0

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
    position_security: int = 0
    upside: int = 0
    graded: bool = False

    @property
    def adjusted(self) -> float:
        """Season points if he played every week, corrected for context.

        Deliberately *not* scaled by availability. The games he misses are
        priced once, in `lineup`, where they fall through to whoever is next at
        his position — scaling here as well would charge for them twice.

        `upside` belongs here rather than as a bonus on the board because it
        says the same kind of thing the other two do: this projection is
        wrong, by about this much. Putting it here also gets the guard the
        bonus needed by hand — a backup quarterback's breakout is worth
        nothing to us — for free, since `lineup` never plays him.
        """
        return self.points * (1 + OFFENSE_WEIGHT * self.offense
                              + SECURITY_WEIGHT * self.position_security
                              + UPSIDE_WEIGHT * self.upside)


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
        f"""SELECT p.player_id, p.full_name, p.position, p.team, p.injury_status,
                   p.depth_chart_order, pr.{adp_column} AS adp,
                   g.offense, g.position_security, g.exp_games, g.upside
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
        expected_games = (row["exp_games"] if graded
                          else SEASON_GAMES * DEFAULT_AVAILABILITY.get(row["position"], 0.85))
        healthy_starting_qb = (
            row["position"] == "QB"
            and row["depth_chart_order"] == 1
            and expected_games >= 10.0
            and (row["injury_status"] or "") not in CURRENT_INJURY_STATUSES
        )
        if healthy_starting_qb:
            expected_games = max(expected_games, HEALTHY_QB_FLOOR_GAMES)
        pool.append(Player(
            player_id=row["player_id"],
            name=row["full_name"],
            position=row["position"],
            team=row["team"],
            adp=row["adp"],
            points=points[row["player_id"]],
            availability=expected_games / SEASON_GAMES,
            offense=row["offense"] or 0,
            position_security=row["position_security"] or 0,
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


def lineup_filled(roster: list[Player], slots: list[str]) -> bool:
    """Whether the roster can fill every non-bench slot at once."""
    have = Counter(player.position for player in roster)
    exact = Counter(slot for slot in slots if slot not in ("BN", "FLEX"))
    if any(have.get(position, 0) < count for position, count in exact.items()):
        return False
    flex_left = sum(max(0, have.get(position, 0) - exact.get(position, 0))
                    for position in FLEXABLE)
    return flex_left >= slots.count("FLEX")


def option_value(player: Player, roster: list[Player], slots: list[str],
                 base: dict[str, float]) -> float:
    """Small, asymmetric value for a useful bench player's favorable tail.

    The downside of a bench pick is a drop; the upside is that his role grows
    enough to matter. It applies only to an RB/WR/TE selected after the current
    roster can already field its full starting lineup. QB, K, and DEF never
    receive it.
    """
    if player.position not in FLEXABLE or not lineup_filled(roster, slots):
        return 0.0
    surplus = max(0.0, player.adjusted - base.get(player.position, 0.0))
    return (BENCH_UPSIDE_POINTS * max(0, player.upside)
            + BENCH_OPTION_WEIGHT * surplus)


def draft_gain(player: Player, roster: list[Player], slots: list[str],
               base: dict[str, float]) -> float:
    """Value added by a draft pick: lineup production plus bench option."""
    lineup_gain = gain(player, roster, slots, base)
    return lineup_gain + option_value(player, roster, slots, base)


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
    ranked = sorted(((draft_gain(p, roster, slots, base), p)
                     for p in pool if p.position == position),
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


def wait_outcomes(position: str, pool: list[Player], pick: int, roster: list[Player],
                  slots: list[str], base: dict[str, float], depth: int = 40,
                  minimum_contribution: float = 0.05) -> list[tuple[float, float, Player | None]]:
    """The probable player outcomes for waiting on a position.

    Players are ordered by quality (lineup gain). A player's probability of
    being our choice is his availability times the chance every better player
    is gone. We retain an outcome only when that probability times its gain is
    material; the remainder means no worthwhile player is available.
    """
    ranked = sorted(((draft_gain(p, roster, slots, base), p)
                     for p in pool if p.position == position),
                    key=lambda pair: -pair[0])[:depth]
    still_gone, outcomes = 1.0, []
    for value, player in ranked:
        chance = survival(player.adp, pick)
        mine = still_gone * chance
        if mine * value >= minimum_contribution:
            outcomes.append((mine, value, player))
        still_gone *= 1 - chance

    residual = max(0.0, 1.0 - sum(probability for probability, _, _ in outcomes))
    if residual:
        outcomes.append((residual, 0.0, None))
    return outcomes


def _sample_outcome(outcomes: list[tuple[float, float, Player | None]], seed: int
                    ) -> tuple[float, Player | None]:
    """Draw one deterministic, probability-weighted outcome for a plan path."""
    unit = ((seed * 1103515245 + 12345) & 0x7fffffff) / 0x80000000
    running = 0.0
    for probability, value, player in outcomes:
        running += probability
        if unit <= running:
            return value, player
    return outcomes[-1][1], outcomes[-1][2]


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
# buys almost nothing. K and DEF are flat enough to be selected later, but they
# still need to be part of the plan: excluding them lets a first-pick K/DEF
# claim its gain without ever spending a later pick on one.
PLAN_AHEAD = 4
PLAN_POSITIONS = ("RB", "WR", "TE", "QB", "K", "DEF")


def plan_positions(roster: list[Player], slots: list[str],
                   positions: tuple[str, ...] = PLAN_POSITIONS) -> tuple[str, ...]:
    """Positions that can still add a player to the draft plan.

    K and DEF are single-purpose roster slots, not depth positions.  Once all
    of a league's slots at either position are filled, a later pick there is a
    replacement rather than useful roster construction.  The lineup model can
    assign that replacement a tiny positive gain, but the draft planner should
    not spend a second roster spot chasing it.
    """
    have = Counter(player.position for player in roster)
    needed = Counter(slot for slot in slots if slot in STREAMABLE)
    return tuple(position for position in positions
                 if position not in STREAMABLE
                 or have.get(position, 0) < needed.get(position, 0))


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
    for position in plan_positions(roster, slots, positions):
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


def _continuation_stats(picks: list[int], roster: list[Player], available: list[Player],
                        slots: list[str], base: dict[str, float],
                        positions: tuple[str, ...] = PLAN_POSITIONS,
                        sample_key: int = 1) -> tuple[float, float]:
    """Return the mean and best value of every modeled continuation.

    Each position choice is one branch. Within it, the player is drawn from
    the probability-weighted outcomes at that position. Every position path
    gets its own deterministic draw, so the mean combines likely players over
    all modeled plans without making the live board enumerate an intractable
    player-by-player tree.
    """
    if not picks:
        return 0.0, 0.0
    mean_totals, best_totals = [], []
    for index, position in enumerate(plan_positions(roster, slots, positions)):
        outcomes = wait_outcomes(position, available, picks[0], roster, slots, base)
        if not outcomes:
            continue
        got, player = _sample_outcome(outcomes, sample_key * 7 + index)
        if player is None:
            mean_rest, best_rest = _continuation_stats(
                picks[1:], roster, available, slots, base, positions,
                sample_key * 7 + index)
        else:
            mean_rest, best_rest = _continuation_stats(
                picks[1:], roster + [player],
                [p for p in available if p.player_id != player.player_id],
                slots, base, positions, sample_key * 7 + index)
        mean_totals.append(got + mean_rest)
        best_totals.append(got + best_rest)
    if not mean_totals:
        return 0.0, 0.0
    return sum(mean_totals) / len(mean_totals), max(best_totals)


def outlook(sit: Situation, candidates: list[Player], gains: dict[str, float],
            ahead: int = PLAN_AHEAD) -> tuple[dict[str, float], float, dict[str, float]]:
    """Mean continuations after spending this pick on each position.

    Returns each position's mean continuation, the grand mean across all
    modeled first-position plans, and the best-plan total for tooltip context.
    The board adds a player's direct gain to its continuation, then subtracts
    that grand mean. This is the one score used to rank and recommend picks.
    """
    picks = sit.upcoming[:ahead]
    rest_of, best_plan, starting_averages = {}, {}, []
    open_positions = plan_positions(sit.roster, sit.slots)
    for position in {p.position for p in candidates if p.position in open_positions}:
        # The player the board would take, which is simply the best gain now
        # that upside is inside it rather than added on afterwards.
        got, player = max(((gains[p.player_id], p) for p in candidates
                           if p.position == position), key=lambda pair: pair[0])
        rest_of[position], best_rest = _continuation_stats(
            picks[1:], sit.roster + [player],
            [p for p in sit.available if p.player_id != player.player_id],
            sit.slots, sit.base)
        starting_averages.append(got + rest_of[position])
        best_plan[position] = got + best_rest
    overall_average = (sum(starting_averages) / len(starting_averages)
                       if starting_averages else 0.0)
    return rest_of, overall_average, best_plan


@dataclass
class Ranked:
    player: Player
    value: float
    gain: float
    option: float
    cost: float
    overall_average: float
    best_plan: float


def board(conn: sqlite3.Connection, league_id: str, draft_id: str,
          limit: int = 200, ahead: int = PLAN_AHEAD) -> tuple[list[Ranked], list[Player], list[int]]:
    """Rank what's left by what it's worth to us at the pick we're on.

    Each row's score is its mean modeled team value over every continuation
    after taking that player, compared with the mean of all modeled plans.

        score(i) = gain(i) + mean_continuation(position after taking i)
                   - mean(all plans)

    `plans` remains a separate, best-case path explorer. It is useful to
    explain upside, but it does not participate in the recommendation score.
    """
    sit = situation(conn, league_id, draft_id)

    forced = must_fill(sit.roster, sit.slots, len(sit.upcoming))
    open_positions = plan_positions(sit.roster, sit.slots)
    pickable = ([p for p in sit.available if p.position in forced]
                if forced else [p for p in sit.available if p.position in open_positions])
    candidates = sorted(pickable, key=lambda p: p.adp)[:limit]

    lineup_gains = {p.player_id: gain(p, sit.roster, sit.slots, sit.base)
                    for p in candidates}
    options = {p.player_id: option_value(p, sit.roster, sit.slots, sit.base)
               for p in candidates}
    gains = {p.player_id: lineup_gains[p.player_id] + options[p.player_id]
             for p in candidates}
    rest_of, overall_average, best_plan = outlook(sit, candidates, gains, ahead)

    ranked = []
    for player in candidates:
        got = gains[player.player_id]
        score = got + rest_of[player.position] - overall_average
        ranked.append(Ranked(player, score, lineup_gains[player.player_id],
                             options[player.player_id], -score, overall_average,
                             best_plan[player.position]))
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
    for position in plan_positions(sit.roster, sit.slots, positions):
        options = [(draft_gain(p, sit.roster, sit.slots, sit.base), p)
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

    print(f"\n  {'value':>7} {'gain':>7} {'option':>7} {'cost':>7}  "
          f"{'pos':4} {'adp':>6}  player")
    for row in ranked[:args.top]:
        flag = " " if row.player.graded else "?"
        print(f"  {row.value:7.1f} {row.gain:7.1f} {row.option:7.1f} {row.cost:7.1f}  "
              f"{row.player.position:4} {row.player.adp:6.1f}  {row.player.name}{flag}")
    conn.close()


if __name__ == "__main__":
    main()
