# Algorithm experiments — final coordination state

All eight experiment families have final decisions. The five resumed agents updated their branch notes as results arrived and committed their completed reports. No further experiments are running.

## Integrated on algo-improvements

Production/backtest defaults and multi-seed reporting; flat bench-upside removal; fixed preseason spread preference (ceiling production commit66a0b77 integrated as7b2cc9b). Planning remains4 picks /250 candidates. Rollout is not shipped.

Fresh merged normal backtest: seeds1–8,96 drafts,2047.4 ±8.4 points versus original production-aligned1896.4 ±9.5 and ADP1846.1 ±14. Saved held-out spread result2038.2 versus bench-only2005.0. Full216-environment matrix on merged code NOT run. Targeted checks are not a substitute. See docs/experiments/2025-algorithm-diagnosis.md and final-2025-seeds-1-8.json. Final publishing gate:33 tests passed; app/worker syntax checks passed.

## Branch outcomes and final note commits

- algo/bench-option: keep simple BUP0; original implementationc7d6560 integrated7b803fb; note959c769.
- algo/qb-depth: reject extra depth; note60607df.
- algo/baselines: reject replacement tuning; noteacccecd.
- algo/ceiling: keep fixed heuristic; production66a0b77; final notescfd5bd6.
- algo/correlation: reject small corrected gains; final notes5b9bbec.
- algo/room-sim: reject weak concentrated gain; final notesd0071e8.
- algo/streamable: preserve current baseline; fresh interactions lose on every seed; final notesd693289.
- algo/rollout: defer despite default gain/speed; cross-format regressions plus truncated trajectories and >15-round horizon flaws; final notes9e216c2. Exact future fixes documented in its report.

Each worktree retains HANDOFF.md and handoff-artifacts. Original dirty experiments are preserved; do not merge artifact branch histories into production. Reports are copied to docs/experiments (bench and ceiling have standalone docs). Reports may include historical running checkpoints followed by final verdicts.

## Publishing

Existing PR#1 was discovered during resume: https://github.com/taylars/fantasy-drafter/pull/1 (algo-improvements -> main). PR updated with completed reports, final results, and explicit full-matrix-not-run caveat. Branch pushed through a2b0dbb before this final note. Title: Align backtests and improve bench and lineup valuation. No automatic PR merge.

## Caveats

One season, archived projections not proven preseason snapshots, repeated seat/seed dependence, follow-up reuse of heldout rooms, uncalibrated spread assumptions. No exhaustive merged matrix or broad browser benchmark. The proposed score is a heuristic, not expected points or championship probabilities.

## Matrix progress and app verification (2026-08-27)

Matrix CLI now reports configuration/strategy, seats, completed/total drafts, percentage, elapsed time and rough ETA to stderr. `--quiet` disables logging; `--json` stdout remains clean. Progress advances between drafts, not during a synchronous simulation. The full matrix remains 216 configurations / 4,752 drafts and has NOT been completed on the merged code. Startup smoke was intentionally terminated after its first configuration log. Focused matrix regression checks verify logging does not change results.

Browser smoke: real public Sleeper data for taylars, Atlanta League completed draft and A league far, far away… upcoming draft. Verified league switching, roster/drafted rendering, reload persistence, updated score tooltips, 541 player rows, three upcoming-draft recommendations, no NaN/Infinity values, and no browser warnings/errors. No live pick was submitted. Actual worker handler tested against direct shared-model output for snake/linear drafts at early/middle/late stages and initialization resets. This is browser smoke coverage, not a benchmark or exhaustive device/league test.

Final verification for this update: `npm test` — 36 passed, 0 failed; `git diff --check` clean.
