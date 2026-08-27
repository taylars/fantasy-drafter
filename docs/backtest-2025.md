# 2025 historical backtest

The board's behavioral specification is a season backtest: draft complete
leagues from archived preseason inputs, then reveal actual results one week at
a time and start the best legal lineup. This measures the result we care about
— how many points the drafted team can score — rather than whether one internal
term moved in the expected direction.

## Result

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
- Season: Weeks 1–17, optimized legal starters, no transactions

Run the small baseline with `npm run backtest`. Run the exhaustive matrix with
`npm run backtest -- --matrix`; add `--json` for the complete machine-readable
breakdown. The quick test suite validates the frozen data, draft legality,
determinism, weekly lineup selection, and the board-versus-ADP comparison. It
does not run the exhaustive matrix on every commit.

## Data boundary and limitations

The committed fixture contains 300 players, three ADP columns, three season
projection totals, and actual weekly points under all three scoring formats.
Draft strategies receive only identity, position, ADP, projection, and neutral
availability. Actual weekly points are passed only to the season scorer.

Sleeper still serves its archived 2025 projection/ADP dataset, but the records
now carry January 2026 modification timestamps. Therefore this benchmark calls
them **archived 2025 projections**, not a provable August snapshot. Each record's
timestamp and the source URLs are retained in the fixture. A dated preseason
snapshot would be a better input and can replace this fixture without changing
the simulator.

Other deliberate limitations:

- No waivers, free agents, trades, or IR moves. This isolates the draft but
  understates strategies designed around active in-season replacement.
- Perfect weekly lineup choice. There is no uncertainty about Sunday decisions.
- No opponent lineup mistakes.
- Mixed opponent styles are simple, explicit policies rather than models fitted
  to real managers.
- The board runs without the current 2026 research grades. Applying those to a
  2025 draft would leak information from another season.
- The grade is a comparison scale, not an academic estimator. A neutral result
  centers around the low-to-mid 70s; points percentile, all-play results,
  weekly ceilings, playoff rate, and championship rate contribute to it.

The next useful expansions are a genuinely dated preseason input snapshot,
transaction policies, repeated stochastic opponents around ADP, and additional
historical seasons. Those improve confidence more than another synthetic rule
about when one position “should” beat another.
