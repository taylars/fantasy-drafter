# The value formula

What the board should rank on, and — the reason to settle it first — exactly
which facts we have to go and gather to compute it. See
[drafting-goals.md](drafting-goals.md) for why these are the right questions;
this is the arithmetic.

## Prior art

This is a well-trodden problem, and the shape below is not original:

- **VBD / VORP / VOLS / VONA.** Value-based drafting compares a player against
  a *baseline* rather than against the field. The baseline choice is the whole
  argument: the last starter (VOLS), the best waiver-wire player (VORP), or the
  best player left at his position at our next pick (VONA).
- **VONA is the one that moves with the draft**, which is what we want: it
  can't be computed in advance, because it depends on who's actually gone.
- **BEER / BEER+** sets the baseline using *man-games* — how many player-games
  a season actually demands once byes and injuries are counted.
- **Depth-2 lookahead is enough.** A dynamic-programming treatment found
  searching deeper than two picks ahead gained essentially nothing.
- **Sobering result from the same work:** pure autodraft loses only ~5 points
  per game against optimal. The gains here are real but small.

## The formula

Four steps, all in season points, so any number on the board can be explained
in a sentence.

**1. Adjust the projection.** `db.projected_points` is the mean case under our
own scoring. The grades correct it:

```
p̂ = pts × (1 + a·offense + b·support)
```

`exp_games` deliberately does *not* appear here. It is priced once, in step 2,
where the games a player misses fall through to whoever is next at his
position. Scaling here as well would charge for them twice.

**2. Price the roster by coverage, not by starters.** A season is 17 weeks and
every starting slot needs all 17 of them. A player only covers the share of the
season he's actually available for, so the games his starters miss fall to the
next man at that position — and to the waiver wire if there isn't one:

```
lineup(roster) = Σ over positions:
    Σ (availability × p̂) over our players at that position, best first,
      until the position's demand is met
    + (whatever demand is left) × baseline(position)

  + FLEX: Σ (leftover availability × p̂) over whoever is spare, best first,
      until the FLEX slots are full
    + (whatever is still empty) × max baseline over RB/WR/TE
```

This replaces a flat "bench is worth 10%" credit, and it is what makes depth
worth paying for: a third RB is not a spare, he is the man who starts the four
games the first two miss.

**The FLEX is settled last, out of leftovers, and is never assigned to a
position.** Handing it to one — enumerating the allocations and keeping the
best — looks equivalent and is not, because step 3 floors an unfilled slot at
its baseline. A FLEX nominally allocated to TE then collects the *TE* baseline
for free, and in this league that is 115 against a receiver's 96, so the model
preferred two imaginary waiver tight ends to any real receiver it could put
there. On a live board at pick 73 it priced all fifteen available receivers at
exactly 0.0, Malik Nabers among them — 64 points clear of the wire, worth
nothing. Carrying the FLEX as its own demand and filling it from spare
player-weeks fixes it, and drops the allocation search entirely.

**3. The baseline is per-position, and it hinges on streamability.** This is
the single most consequential number in the model. Only two positions can
actually be refilled week to week; for everything else an empty slot means
playing whoever is left after the draft:

| pos | last starter (VOLS) | real waiver level | gap |
|---|---|---|---|
| RB | 160 | **59** | **102** |
| WR | 176 | 98 | 78 |
| QB | 285 | 251 | 34 |
| TE | 131 | 113 | 17 |
| DEF | 92 | 91 | **1** |
| K | 105 | 105 | **0** |

K and DEF are free — the gap is zero, so a top-12 kicker is always a waiver
claim away. RB is a 102-point cliff. So streamable positions get the
last-starter baseline and everything else gets the best player left *after the
draft ends* (`ADP > teams × rounds`).

Two things follow that the earlier VOLS-only version got wrong:

- A slot is worth **at least** its baseline. Without that floor, adding a
  below-baseline player to an empty FLEX scores *negative*, and the prototype
  duly ranked a waiver-tier RB second overall.
- Assuming a free 142-point RB made a four-receiver draft look optimal. At the
  true waiver level of 59 it does not.

**4. Depth floors.** An expected-value model averages injuries out; a season
doesn't. You cannot cover a mandatory RB slot with a receiver, and the RB
waiver wire is that 102-point cliff, so the model carries a minimum regardless
of what the slots alone imply:

```
DEPTH = {'RB': 3, 'WR': 3, 'QB': 1, 'TE': 1, 'K': 1, 'DEF': 1}
```

This is a stated assumption, not a derivation. It is worth knowing how much it
costs: without it the model preferred four receivers at pick 48 by **4.1
points** — it was nearly indifferent, so the floor buys real insurance cheaply.

**5. Rank on regret against the best plan.**

```
gain(i)    = lineup(roster + i) − lineup(roster)
wait(pos)  = Σⱼ gain(j) · P(j survives) · Π_{k better}(1 − P(k survives))
cost(pos)  = best plan going − what's left after spending this pick on pos
value(i)   = gain(i) − cost(pos(i)) + upside(round)
```

Survival is a smooth function of (our next pick − ADP). `wait` is still the
engine — it is how the plan below prices a pick we haven't reached yet — but it
is no longer what the board ranks on directly. Ranking a single pick on
`gain − wait` prices the position as if this pick were the only one left, which
flatters a thin position: scarcity gets credited, and the deep positions still
to fill are never charged for.

So the board ranks on the plan instead. Value is regret, in season points: the
pick to make sits at zero and everything below it is what taking that player
instead costs the rest of the draft.

## Roster and future picks

**Existing roster: yes**, directly — `gain()` is measured against the lineup we
already hold.

**Future picks: plan over them, don't peek one turn ahead.** This is what the
board ranks on, not a separate tool alongside it — they were two calculations
once, and drifted far enough apart to give opposite advice about a tight end at
pick 49. Three things a naive version gets wrong:

1. **Turns are not picks.** A snake turn is often two picks (our slot-1 turns
   are `24·25`, `48·49`), so a three-turn plan is six players, not three.
2. **The roster has to evolve inside the plan.** Score a *sequence* — take a
   position, add the expected player, re-price the next pick against that
   roster — rather than scoring each pick independently.
3. **Prefixes are shared.** Searching recursively rather than enumerating whole
   sequences prices every prefix once instead of once per sequence starting
   with it — the same 256 plans for a third of the work, which is what makes
   this affordable to run on every row of a live board.

The output that answers "RB now or later" is the best plan starting with each
position, differenced against the best plan overall:

```
@ pick 49, holding Bijan + Kyren + Pickens + Flowers — planning 49, 72, 73, 96
  RB    279.1   +0.0   RB/WR/WR/QB   Jadarian Price
  WR    272.8   -6.3   WR/WR/RB/QB   Jameson Williams
  TE    255.8  -23.3   TE/WR/RB/QB   Tyler Warren
  QB    250.9  -28.3   QB/WR/RB/WR   Caleb Williams

@ pick 73, the same roster plus Warren + Washington — planning 73, 96, 97, 120
  RB    201.7   +0.0   RB/WR/QB/WR   Kyle Monangai
  QB    199.7   -2.0   QB/RB/WR/WR   Caleb Williams
  WR    198.8   -2.9   WR/RB/QB/WR   Jayden Reed
  TE    190.7  -11.0   TE/RB/WR/QB   Mark Andrews
```

At 49 the tight end is 23 points behind and the quarterback is nearly a round's
worth of value away. By 73 the quarterback has closed to 2 — the position is
flat enough that Caleb Williams at 75 and Jared Goff at 140 are worth almost
the same thing, so the gap to be paid for is small. Same draft, twenty-four
picks apart.

The per-position drop-off shows why — what one more turn of waiting costs:

```
        @ pick 24                    @ pick 48
        now     +48     +72          now     +72     +96
  RB   105.5   100.5    75.0        42.7    14.0     5.5
  WR   103.6    75.6    65.4        75.7    65.4    51.0
  TE    73.1    40.4    26.3        49.2    26.3    18.3
  QB    88.7    50.1    38.9        51.9    38.9    35.2
  K     10.7    10.7    10.7        10.7    10.7    10.6
  DEF   19.0    19.0    18.9        19.0    18.9    18.2
```

K and DEF are *perfectly flat* across the whole draft — the clearest possible
statement that they are never urgent, and the model arriving at your own rule
on its own.

## As implemented

`value.py` is the formula above; five things about it were only settled by
building it and running drafts through it.

- **Gain is monotone, and that took work.** Adding a player must never lower
  the roster. Two separate things broke it: choosing the FLEX allocation
  greedily, and letting a sub-replacement player *displace* the waiver option
  instead of being ignored (fixed by flooring every covered week at the
  baseline). Both showed up as negative gains, which made `wait` negative,
  which inflated the value of whoever caused it.

  The first fix — maximize over every way of allocating the FLEXes — restored
  monotonicity but bought a worse bug with it, the free-waiver-tight-end above.
  Filling the FLEX from leftovers instead is monotone *and* right, and it needs
  no search. `python3 -m scripts.check_coverage` holds both properties down:
  monotonicity over 1,000 random rosters, and the rule the allocation search
  broke — anyone better than the wire must be worth something in an open FLEX.
  Worth running any time the coverage model is touched.

- **Upside scales by gain, not by points.** A backup quarterback has no route
  into the lineup, so his breakout is worth nothing to us. Paying him a bonus
  on his projection instead of on what he adds is how a simulated draft ended
  up taking five quarterbacks.

- **There is no risk term.** The doc above proposed one; it would double-count.
  Downside is already priced through `exp_games`, which hands a fragile
  player's missed games to the next man in the coverage step. Tyreek Hill, at
  0.12 availability after a season-ending knee injury, comes out at a gain of
  exactly 0.0 against an empty roster.

- **The board and the plan are one search.** The board is the plan read
  per-player: `value(i) = gain(i) + continuation(pos) − best plan`, so the best
  player at each position scores exactly that position's plan delta, less his
  own upside bonus. `scripts.check_coverage` asserts that equality — it is the
  cheapest guard against the two drifting again, which they did once and
  expensively. The cost is real: the board went from 0.03s to 1.6s, because it
  now runs a four-deep search rather than one pass. That is affordable at a
  draft's pace, and `--ahead 2` is there when it isn't.

- **Legality is separate from value.** A kicker is worth ~0 to draft at any
  point, correctly — so left alone the model never drafts one, and a roster
  with no kicker cannot field a lineup. `must_fill` restricts the board once
  the picks remaining are down to the slots still empty, which is a roster
  rule rather than a valuation.

Run through a full 15-round draft with ADP-driven opponents, it fills every
slot, carries the depth floors exactly, and takes its kicker and defense in
rounds 10–11:

```
QB 2   RB 3   WR 4   TE 4   K 1   DEF 1
```

Two behaviors worth checking against your own judgment. Holding three backs the
fourth is priced at exactly 0.0, because the depth floor of three is acting as
a ceiling as well as a floor. And the endgame picks are near-arbitrary — values
of 3.7, 1.2, 0.5, 0.1 — which is the model honestly reporting that those picks
barely matter, but a human would spend them on handcuffs and lottery tickets.

## What this tells us to go gather

| Input | Status |
|---|---|
| `pts`, ADP, roster + scoring rules, our own future picks | **have it** |
| `offense`, `support`, `upside` grades | **must gather** — no endpoint has them |
| expected games (availability) | **must gather** — see below |
| ADP spread (σ) | **must gather** — a real gap |

1. **`gp` is worthless.** It is 18.0 for 984 of the 1,016 players with an ADP
   and 1.0 for the rest — not a projection of games played. Availability is now
   load-bearing in step 2, and it is currently a hard-coded position average
   (`RB .79, WR .85, QB .88, K .97`). Replacing those constants with a per-player
   number is the highest-leverage thing research can produce, so ask for
   expected games directly ("13 of 17"), not a 1–5 health score.

2. **We have no ADP spread, and step 5 needs one.** Sleeper publishes a mean
   ADP and nothing about its variance, so the prototype guesses
   `σ = max(4, 0.15·ADP)`. Better to measure it from repeated mock drafts — we
   can already register mocks by id — than to grade it as an opinion.

3. **The QB baseline is real, not a bug.** 251 looks absurd until you notice
   ~21 QBs go inside 180 picks and only 12 start, so the 22nd-best QB really
   does project 251. Streaming QB genuinely is close to free in this league.

4. **Still to settle:** byes are not modeled separately (they are folded into
   availability), and the depth floors are judgment rather than measurement.
   Both are tunable constants, so both are cheap to revisit.

## The grades table

The columns are exactly what the formula consumes — no more:

```sql
CREATE TABLE player_grades (
    player_id  TEXT NOT NULL REFERENCES players(player_id) ON DELETE CASCADE,
    season     TEXT NOT NULL,
    offense    INTEGER,   -- -2..+2, the offense he plays in
    support    INTEGER,   -- -2..+2, the teammates his production depends on
    exp_games  REAL,      -- expected games of 17 — replaces the dead gp
    upside     INTEGER,   --  0..+3, room above the projection
    note       TEXT,      -- one line of why, in plain english
    sources    TEXT,      -- json array of urls it was read from
    graded_at  TEXT,
    PRIMARY KEY (player_id, season)
);
```

Grades are ordinal because that's what research can produce defensibly; turning
−2..+2 into a multiplier is the formula's job, not the researcher's. Only the
top ~200 by ADP need grading — below that the differences are under a point.
