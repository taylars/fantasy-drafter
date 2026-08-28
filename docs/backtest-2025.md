# 2025 historical backtest

The board's behavioral specification is a season backtest: draft complete
leagues from archived preseason inputs, then reveal actual results one week at
a time and start the highest-projected legal lineup. This measures the result we care about
— how many points the drafted team can score — rather than whether one internal
term moved in the expected direction.

## Result

For the current production-default diagnosis, multi-seed baseline, and
subsequent strategy experiments, see
[2025 algorithm diagnosis](experiments/2026-08-27-009-algorithm-diagnosis.md).
The older tables below are retained as history, not the current benchmark.

The tables also predate projection-selected lineups and injury replacement
baselines. They remain historical results, not the current benchmark.

**Historical result:** the tables below predate the roster-aware scripted ADP
policy. They are not scores for the current simulator. Rerun the benchmark on
a stable dataset to compare the updated opponents.

The results below are the **previous neutral-grade baseline**. They predate the
reconstructed 2025 grades and must not be read as results for the newly graded
fixture. The exhaustive matrix has not been rerun for this research update.

The full matrix contains 216 environments and evaluates every seat in each:
2,376 seasons for the board and 2,376 for the ADP baseline.

| Strategy | Grade | Points percentile | All-play win rate | Playoffs | Championships | Avg finish |
|---|---:|---:|---:|---:|---:|---:|
| Current board | **C+ (79.7)** | 69.9% | 58.6% | 68.4% | 29.6% | 3.96 |
| ADP | **C− (71.3)** | 50.0% | 50.0% | 54.5% | 9.1% | 6.23 |

The championship result is not a forecast that this strategy wins 30% of real
leagues. Each seat is run in a counterfactual league with deterministic
opponents, fixed rosters, perfect weekly lineup selection, and no waivers or
trades. It is useful as a comparison with the identically simulated ADP
baseline, not as an absolute probability.

### Board breakdown

| Dimension | Grade | Notable result |
|---|---:|---|
| 8 teams | C (74.1) | 52.1% all-play; little edge in a shallow player pool |
| 10 teams | C+ (77.8) | 56.9% all-play |
| 12 teams | B− (82.1) | 60.6% all-play |
| 14 teams | B− (82.3) | 61.7% all-play |
| Snake | C+ (79.4) | 58.2% all-play |
| Third-round reversal | B− (80.5) | strongest draft-order slice |
| Linear | C+ (79.3) | close to snake |
| Classic, one FLEX | B− (82.0) | best roster shape |
| Double FLEX | C+ (77.4) | weakest roster shape |
| Three WR | C+ (79.8) | 58.9% all-play |
| Standard | C+ (77.3) | weakest scoring slice |
| Half-PPR | C+ (79.2) | 57.3% all-play |
| PPR | B− (82.8) | strongest scoring slice |
| ADP rooms | B− (80.1) | 58.7% all-play |
| Mixed-style rooms | C+ (79.4) | 58.5% all-play |

The board averaged 663 points and 62.5 starts from players selected into bench
slots, versus 514.8 points and 63.1 starts for ADP. That is a result, not yet a
diagnosis: it says the board's late picks contributed more points when started;
it does not say which bench-value mechanism produced them.

## Matrix

- Team counts: 8, 10, 12, 14
- Draft orders: snake, third-round reversal, linear
- Rosters: classic one-FLEX, double-FLEX, three-WR
- Scoring: standard, half-PPR, PPR
- Opponents: pure ADP, or a deterministic mixture of ADP, Robust RB, Zero RB,
  and late-QB behavior
- Draft seats: every seat in every environment
- Season: Weeks 1–17, projection-selected legal starters, injury replacement baselines

Run the small baseline with `npm run backtest`. Run the exhaustive matrix with
`npm run backtest -- --matrix`; add `--json` for the complete machine-readable
breakdown. The quick test suite validates the frozen data, draft legality,
determinism, weekly lineup selection, and the board-versus-ADP comparison. It
does not run the exhaustive matrix on every commit.

## Data boundary and limitations

`data/historical/2025/draft.json` contains 300 players, three ADP columns, and
three season projection totals. `weeks/week-01.json` through `week-17.json`
hold actual weekly points under all three scoring formats, so any week can be
corrected independently.
Draft strategies receive only identity, position, ADP, projection, and numeric
season-specific grades/availability (neutral defaults for null grades). Actual
weekly points are passed only to the season scorer.

Sleeper still serves its archived 2025 projection/ADP dataset, but the records
now carry January 2026 modification timestamps. Therefore this benchmark calls
them **archived 2025 projections**, not a provable August snapshot. Each record's
timestamp and the source URLs are retained in the fixture. A dated preseason
snapshot would be a better input and can replace this fixture without changing
the simulator.

Other deliberate limitations:

- No actual waiver transactions, trades, or IR moves; injury replacement is a
  weekly scoring baseline, not a transaction simulator.
- All teams use the same weekly projection-based lineup policy.
- Mixed opponent styles are simple, explicit policies rather than models fitted
  to real managers.
- The board runs with reconstructed 2025 grades, never current 2026 grades.
  Source-date metadata and team consistency are checked, but retrospective
  grading and post-season projection/ADP provenance prevent a guarantee of no
hindsight. Evidence gaps are explicitly marked as conservative defaults.
- The grade is a comparison scale, not an academic estimator. A neutral result
  centers around the low-to-mid 70s; points percentile, all-play results,
  weekly ceilings, playoff rate, and championship rate contribute to it.

## Weekly starters and injury replacements

Starter selection uses archived Sleeper weekly projections under the league's
scoring format, never that week's actual points. Exact positions are filled
first, then FLEX. Missing projections are not replaced with actual scores;
players without a projection and players on bye are ineligible to start.

Confirmed historical `Out` and injury-related reserve (IR/PUP/NFI) designations
come from nflverse weekly injuries and rosters, joined by GSIS/Sleeper IDs.
Current injury fields embedded in Sleeper player objects are ignored.
Questionable/doubtful status alone, healthy zeroes, suspensions, byes, and
injuries sustained during a game do not trigger replacement credit.

For each position and week, exclude everyone drafted by **any** team, injured
players, byes, and players without a positive projection. Rank the remaining
players by that week's projection and take ten (or all if fewer exist).
Their average projection is the replacement's lineup-selection value; their
average **actual** score is its scored result. No candidates means no credit.
The free-agent pool includes projected players beyond the 300-player draft pool.

An injured roster player can represent this same-position baseline in a legal
lineup; a better-projected healthy bench player takes precedence. Credit is
awarded only for selected lineup slots, never every injured bench player.
Multiple injury slots use the same positional average; no individual free agent
is acquired, and rosters remain unchanged. Replacement points are not counted
as production by bench-drafted players.

Each weekly file stores projection timestamps, source URLs, injury designations,
and the expanded free-agent pool. These archives have post-game modification
timestamps, so **they are not verified pre-kickoff snapshots**. The scorer no
longer selects using actuals, but the source history cannot guarantee no leakage.

Capture/enrich existing weekly result files with:

```sh
node bin/historical-week-inputs.mjs --season=2025
node bin/historical-week-inputs.mjs --season=2026 --week=1
```

Run this after `historical:week` when refreshing a week's actuals. A backtest
without the enriched weekly inputs fails explicitly. Draft policies, grade
weights, schedule, and playoff rules are unchanged by this scoring update.

The next useful expansions are a genuinely dated preseason input snapshot,
transaction policies, repeated stochastic opponents around ADP, and additional
historical seasons. Those improve confidence more than another synthetic rule
about when one position “should” beat another.
