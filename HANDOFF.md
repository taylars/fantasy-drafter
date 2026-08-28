# streamable — resumed 2026-08-27

Branch `algo/streamable`. Original negative rung tests finished; original comment-only commit c13502d already integrated by root.

## Active bounded continuation

Testing BUP0 (flat BENCH_UPSIDE_POINTS = 0) plus K/DEF replacement baseline moved 40% and 100% from last starter toward best projected player. Eight discovery seeds, 12 seats, production ahead=4/board=250; evaluator, opponents and data unchanged. No ceiling interaction. Snapshots and runner saved under handoff-artifacts/streamable-bup0; live per-seed checkpoints in /private/tmp/streamable-bup0-{0.4,1.0}/progress.json. Full results will be copied as each finishes. Control is bench-option handoff-artifacts/fantasy-bench-validation/bup0/results.json (2004.6 ±7.4).

No production source changes. Original context: handoff-artifacts/original-session-audit.md. Held-out room seeds are not held-out seasons.

## First checkpoint (partial, not final)

0.4: 1=1952.6, 2=1977.7, 3=1944

1.0: 1=1865.1, 2=1922.7

Both directions below BUP0 so far; await all eight seeds before verdict.

## Second checkpoint (partial)

0.4: 1=1952.6, 2=1977.7, 3=1944, 4=1977.1, 5=2015.5, 6=1971.9, 7=1979.7

1.0: 1=1865.1, 2=1922.7, 3=1821.9, 4=1861.4, 5=1898.5

Unchanged branch tests passed 28/28. Both rungs remain negative on every completed seed.

## Final checkpoint — COMPLETE

Both jobs finished successfully. 40%: **1977.6 ±8.2**, paired **−27.0 ±4.9** vs BUP0; 100%: **1876.2 ±9.2**, paired **−128.4 ±5.7**. Every seed loses for both candidates. Reject; do not merge either strategy. No additional heldout/production experiment warranted. Tests on unchanged branch passed28/28; js/value.js, evaluator, policy and data remain untouched. Raw results, candidate snapshots, paired statistics and full original/fresh trial report saved in handoff-artifacts/streamable-bup0/REPORT.md. No running experiments remain.
