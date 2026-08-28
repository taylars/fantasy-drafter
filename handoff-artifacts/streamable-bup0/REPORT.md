# Streamable K/DEF interaction — COMPLETE, reject both candidates

## Method

BUP0 removes the flat BENCH_UPSIDE_POINTS bonus and keeps every other strategy term unchanged. Raise streamable replacement from `last` to `last + rung * (best - last)` at both K and DEF, with the original near-neutral 40% rung and extreme 100% rung. No broad tuning or ceiling combination. Production ahead=4 and board=250, 12-team half-PPR snake, seeds 1–8 and all 12 seats (96 runs per variant). Read only original evaluator, policy and 2025 data. No post-draft data enters strategy. Isolated snapshots under /private/tmp/streamable-bup0-{0.4,1.0}; only js/value.js differs. Raw points and grades persisted here.

Control reuses the validated bench-option BUP0 artifact (copied as control-bup0.json), not a fresh run. Exact paired seat/seed differences computed from unrounded points; pooled ± is the evaluator's standard error, paired ± is sample SE of the 96 deltas. Draft seats share rooms and only one historical season exists; also report seed-cluster SE. Timing is diagnostic only: concurrent jobs and different run counts make it unsuitable for a runtime speedup claim.

## Final results

| Strategy | Pooled points ± SE | Paired delta ± SE vs BUP0 | Seed-cluster SE |
|---|---:|---:|---:|
| BUP0 control | 2004.6 ±7.4 | — | — |
| BUP0 + 40% rung | 1977.6 ±8.2 | −27.0 ±4.9 | 3.3 |
| BUP0 + 100% rung | 1876.2 ±9.2 | −128.4 ±5.7 | 6.2 |

| Seed | BUP0 points | 40% points | 40% paired delta | 100% points | 100% paired delta |
|---|---:|---:|---:|---:|---:|
| 1 | 1988.1 | 1952.6 | -35.5 | 1865.1 | -123.0 |
| 2 | 2018.1 | 1977.7 | -40.5 | 1922.7 | -95.4 |
| 3 | 1969.8 | 1944 | -25.8 | 1821.9 | -147.9 |
| 4 | 2007.6 | 1977.1 | -30.6 | 1861.4 | -146.2 |
| 5 | 2027.3 | 2015.5 | -11.8 | 1898.5 | -128.8 |
| 6 | 1993.5 | 1971.9 | -21.6 | 1860.7 | -132.8 |
| 7 | 1998.7 | 1979.7 | -19.0 | 1859.3 | -139.4 |
| 8 | 2033.9 | 2002.7 | -31.2 | 1920.1 | -113.8 |

## Original trials, before BUP0

Original baseline 1896.4 ±9.5. Paired deltas: 40% −1.4 ±1.2; 70% −32.0 ±3.5; 85% −46.8 ±3.8; 100% −20.2 ±3.9; K-only100% −60.1 ±4.2. Lowering baseline below the last starter also lost −2.0 ±0.8. These original numbers are transcript evidence, not reruns. Original explanation/comments are already integrated in root (c13502d there cherry-picked as20e2543).

## Verdict and verification

Both interaction candidates lose on every discovery seed; the 100% rung now loses much more than on the old board. Keep the existing last-starter K/DEF baseline. No held-out, cross-format or ceiling interaction tests warranted for rejected variants. No strategy change or production commit. Branch npm test passed all 28 tests; test log saved. This verifies unchanged production, not test compatibility of rejected snapshots. Measuring-stick/data files and branch js/value.js unchanged. All experiment processes completed. No PR or push performed; root owns final aggregation.

Artifacts: run.mjs reproduces eight-seed raw results from a prepared snapshot; value-rung-*.js are complete candidate snapshots; results-rung-*.json and paired-summary.json contain final measurements. summarize.py preserves paired calculations; existing results can be inspected without /private/tmp. Progress files retain partial checkpoints for the interruption audit.
