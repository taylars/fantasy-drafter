# Drafting goals

The goal is one number: **the most points our starting lineup scores over the
season**, under this league's roster structure. Not the best players — the best
*startable* set, across all 17 weeks. The roster shape
(`leagues.roster_positions`) decides where the ceiling is — but "startable" has
to include the weeks a starter is hurt or on bye, so the third running back is
not a spare, he's the man who plays the games the first two miss. Only kickers
and defenses can be refilled off waivers; everywhere else, depth is the
lineup.

Everything below is in service of estimating, at each pick, which available
player moves that number the most.

## Projections are the start, not the answer

`db.projected_points` applies the league's own scoring to the Rotowire stat
line, which is the right baseline and already better than Sleeper's presets.
But a season projection is one provider's average case, and it doesn't know
what we know. Five questions worth asking about every player near the top of
the board:

- **Is the offense good?** Points come from drives. A back on an offense that
  can't reach the red zone is projected on volume he'll get in garbage time.
- **Are the teammates he depends on good?** A WR needs a QB who can throw; a RB
  needs an offensive line; a TE needs a scheme that targets him. The dependency
  runs one way — a great WR doesn't fix a bad QB, but a bad QB caps the WR.
- **Is he injury prone?** Both the history and the current tag. A 16-game
  projection on a player with a 12-game habit is 25% too high, and the games he
  misses are the weeks we lose.
- **Is there upside the projection can't see?** A projection is a mean, and
  means are conservative by construction. Three things reliably sit above one:
  a young player still improving (the second- and third-year jump, which a
  provider averages away); a backup behind someone fragile, who is one hamstring
  from a starter's workload; and a player whose role is touchdowns rather than
  yards — a goal-line back is volatile week to week and worth more than his
  yardage line suggests.
- **Could we get roughly this player later?** The most important one. Value is
  not a player's points, it's the points he adds *over whoever we'd have taken
  instead* at that spot. If the answer is "someone about as good in three
  rounds", his real value here is close to zero.

## What a value score has to weigh

A useful score is dynamic — it changes with every pick made, ours and everyone
else's. Six inputs, roughly in order of how much they move the answer:

1. **Adjusted projection.** `projected_points`, scaled for the context above.
   The questions become multipliers on the projection (offense, role
   security, durability), each a modest factor — call it ±15% — rather than a new
   projection of our own. We are correcting a number, not replacing it.

2. **Lineup gain, not raw points.** Score the player by what he adds to the
   best legal starting lineup we could field, given what we already hold:
   `lineup(roster + player) − lineup(roster)`. This is what makes the roster
   structure matter. In the Atlanta League (QB/RB/RB/WR/WR/TE/FLEX/FLEX) a third
   RB still fills a FLEX and counts nearly in full; a fourth is insurance,
   worth the share of the season the first three don't cover.

3. **The replacement baseline at our *next* turn.** Subtract the lineup gain we
   would expect from the best player at that position still on the board when
   we pick again. This is the whole ballgame: a player is worth the drop-off
   behind him, not his own total. It's also what keeps kickers and defenses off
   the board until the end — every K projects within a few points of the next
   one, so the difference is ~0 no matter how many points the slot itself is
   worth.

4. **Survival probability.** ADP is measured in pick numbers, and the board
   already derives every pick we own from `draft_order`, `teams` and `type`.
   So for each candidate we can estimate the chance he's gone by our next
   turn — a smooth function of (next pick − ADP), not a hard cutoff, since ADP
   is a mean with real spread around it. Take the player who won't last over
   the equal player who will.

5. **Risk.** Injury-prone and boom/bust players have the same mean and a worse
   floor. Penalize variance in the early rounds, where a miss is
   unrecoverable.

6. **Upside.** The same asymmetry pointing the other way, and it should be
   weighted by where we are in the draft. Early picks are bought for their
   floor — we need those points every week. Late picks are lottery tickets
   against a bench slot: the downside is a player we drop in October, so the
   only thing worth paying for is the tail. A backup with a path to starting is
   worth more than a slightly better player with no path at all.

Put together, the score for a candidate is roughly:

```
value = adjusted_lineup_gain(player, roster)
      − E[ adjusted_lineup_gain(best at that position at our next turn) ]
      × P(we still need that position then)
      − risk_penalty(round)
      + upside_bonus(round)
```

Rank on that, and the ordering falls out of the draft state instead of being
written down: the same player is worth different amounts at pick 24 and pick
25, in a PPR league and a half-PPR one, on a roster with two RBs and one with
none.

## Where the inputs come from

Most of this is already in the cache — ADP, the stat line, `gp`,
`injury_status`, `age`, `years_exp`, `depth_chart_order`, the roster and
scoring rules, and every pick made so far.

What isn't is everything the four context questions ask about: how good the
offense is, whether the line blocks, who else eats targets, how the injury
history actually reads, and whether there's a path to more work than the depth
chart shows. No Sleeper endpoint answers any of it.

So it needs a table of its own — grades per player per season, on a common
scale, that the value score reads the same way it reads a projection. The
columns follow from what the formula consumes, so they're specified in
[value-formula.md](value-formula.md) rather than here.

A notebook of hand-written plans is not the place for these — that is prose,
written and read by a person. Grades are an input to a calculation.

Filling it is a research job, and the obvious way to do it is to have AI do the
reading: a skill that defines what each grade means and what a defensible
answer looks like, then sub-agents fanned out over the top ~200 players by ADP,
one batch each, writing rows back.

That makes the grades a second kind of table. The loaders are caches — run one
twice and nothing changes. Grades are reproducible but not deterministic:
re-running the research gives a different answer, sometimes a better one. Hence `sources` and `graded_at` —
enough to see where a grade came from and whether it's gone stale, since a
depth chart in August is not the one from June.
