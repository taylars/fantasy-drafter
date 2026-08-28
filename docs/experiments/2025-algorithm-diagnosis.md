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
recorded below as verification completes.

## Decisions verified so far

| Experiment | Result | Decision |
|---|---|---|
| Flat bench upside | Removing the duplicate flat premium: 2004.6 discovery / 2005.0 held-out room points, versus 1896.4 / 1893.6. All 16 seed averages improve. | Keep; retain the original 0.02 above-wire option share. |
| QB/TE depth | Fractional depth helped the old board, but adding it to the bench fix loses 12.9 discovery / 14.8 held-out points. | Reject additional depth tuning. |
| Replacement baselines | Queue replacement helped the old board, but adding it to the bench fix loses 27.1 discovery points; seven of eight seed averages lose. | Reject; hardcoded slot assumptions and FLEX sensitivity also argue against shipping it. |
| Correlation/stacking | Corrected version adds 7.6 discovery / 11.5 held-out points above the bench fix. The original version falsely penalized a player appearing in both dedicated-slot and FLEX coverage. | Reject: small gains below the experiment's improvement gate, with additional uncalibrated weights. |
| Opponent room simulation | Adds 4.76 discovery points above the bench fix; 84 of 96 totals unchanged, gains concentrated in a few seats. | Reject: weak evidence relative to runtime and model assumptions. |

Full bench trials, sensitivity checks and seed tables are in
[bench-option-experiment.md](../bench-option-experiment.md). Depth and replacement
trials are in [qb-depth.md](qb-depth.md) and
[replacement-baselines.md](replacement-baselines.md). Completed follow-ups are
in [correlation.md](correlation.md) and [room-simulation.md](room-simulation.md).
Other reports are added when each branch closes. Ceiling, rollout and streamable interaction decisions
remain pending at this checkpoint.
