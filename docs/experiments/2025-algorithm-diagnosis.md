# 2025 algorithm diagnosis and experiment continuation

## Measurement contract

The diagnosis began with a misleading single-room result. The backtest planned
two picks ahead against the entire pool while production planned four against
250 candidates. Commits `f8dc709` and `8f691ba` aligned the defaults through
`PLAN_AHEAD`/`BOARD_LIMIT` and added multi-seed reporting. Those are measurement
fixes, not evidence that a strategy improved.

The unchanged production-aligned board was independently rerun with:

```sh
node bin/backtest.mjs --seeds=1,2,3,4,5,6,7,8 --json
```

It reproduced **1896.4 points**, versus **1846.1 for scripted ADP**, over
96 seat/seed combinations (12-team, half-PPR, double-FLEX snake). The raw
summary is in [baseline-2025-seeds-1-8.json](baseline-2025-seeds-1-8.json).

The CLI's standard errors describe dispersion across simulated seat/seed
results, not uncertainty across NFL seasons. Seats in a room and rooms using
the same season are dependent. Paired deltas reduce comparison noise but do
not remove that dependence. Seeds 9–16 are held out from initial parameter
search; they are **not a held-out season**.

All strategy experiments keep the evaluator, opponent policy and historical
data unchanged. Strategy inputs exclude actual weekly outcomes. The archived
2025 projections carry later modification timestamps and are not a verified
preseason snapshot. No second season of weekly outcomes is available. Results
therefore establish behavior on this fixture, not a forecast of real league
wins or future-season gains.

## Scope

Eight experiments were started in separate Claude worktrees, then interrupted
by a spend limit. Their logs and saved results were recovered before continuation.
The final scope is to finish these experiments, combine only supported changes,
and document negative results; no additional broad optimization cycle is planned.

The experiment families are bench option value, QB depth, replacement baselines,
streamable K/DEF baselines, opponent room simulation, correlation/stacking,
ceiling/variance, and deeper rollout. Final outcomes and combination checks are
recorded below after verification.
