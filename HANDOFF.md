# Algorithm experiments paused — 2026-08-27

User requested save and stop. All active agents interrupted; process check found no matching experiment subprocesses. No PR opened or branch pushed. Do not resume until asked.

## Integrated state

Code HEAD92b4812 on algo-improvements: original default/multi-seed fixes f8dc709/8f691ba; statistics/default tests f89c591; bench fix7b803fb; page/CLI shared default fix92b4812. All31 tests passed. Fresh official8-seed run reproduces2004.6 points vs1896.4 old board and1846.1 ADP; heldout bench2005.0. origin/main571c083 is ancestor.

## Branches

- **algo/bench-option**: Complete, integrated: 2004.6 discovery / 2005.0 holdout; +108.2/+111.4 vs baseline. 29 branch tests pass. Commit c7d6560 integrated as 7b803fb.
- **algo/qb-depth**: Complete, reject: fractional depth+BUP0 loses12.9 discovery and14.8 holdout. 28 tests pass. Original experiment preserved.
- **algo/baselines**: Complete, reject: queue+BUP0 loses27.1 discovery; seven of8 seeds worse. 28 tests pass. Original source restored.
- **algo/ceiling**: Paused, promising: BUP0+risk=-.5 scores2047.4, +42.7 discovery. Heldout output exists but parent has not verified it. Next: analyze heldout; small seed17 cross-format checks; only then decide production implementation. Mutable knobs, uncalibrated CV assumptions and runtime require review. Current source may temporarily set BUP0. No merge.
- **algo/correlation**: Paused, likely reject: corrected full+BUP0 gains7.6 discovery; original buggy full gains4.4. Duplicate dedicated/FLEX player coverage caused false collision penalty. Corrected variant28 tests pass. Heldout launched: inspect saved output, not yet verified. No merge.
- **algo/room-sim**: Paused: BUP0 interaction launched; inspect saved output. Original64 simulation +6.5 concentrated few seats; no-needs -12.4;256 simulation +2.1. 28 tests pass. Marginal probabilities still multiplied independently, ownership inferred from pick order, hero picks skipped. Current source may temporarily set BUP0. No merge.
- **algo/rollout**: Not resumed by Codex. Original Claude work: greedy full1882.4 loses; uniform1909.7; ahead5=1912.5 at4.8x runtime. Variants confounded, no final validation or merge. Inspect original log and local tmp scripts before continuing.
- **algo/streamable**: Claude completed; not resumed by Codex. Comment-only commit c13502d. All tested K/DEF baseline rungs lost on old board; original28 tests pass. No strategy change. BUP0 interaction untested.

Each worktree has HANDOFF.md and handoff-artifacts with reports, source snapshots, dirty diff and available scratch results. Do not cherry-pick artifact handoff commits into production automatically. Experimental source changes remain uncommitted where originally uncommitted.

## Remaining

Analyze saved ceiling/correlation/room outputs; rollout and streamable were not resumed. Finish aggregate docs/experiments/2025-algorithm-diagnosis.md; verify any further accepted integration; then PR algo-improvements -> main documenting all failures/results. Original final scope was wrap existing experiments, not more broad tuning.

Root .gitignore change preexisted (preserve). Uncommitted docs/backtest-2025.md,js/backtest.js statistical comment and docs/experiments are our pending documentation. Hand-off commit stages only HANDOFF.md at root.
