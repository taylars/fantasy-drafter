# Reconstructed 2025 grades

This is retrospective research, not a provably frozen August 2025 snapshot.
The evidence cutoff is the end of August 29, 2025 in the source's stated local
calendar date. Searches use `before:2025-08-30`; search filters are imperfect,
so publication dates and article bodies must also be inspected. Current player
widgets, current depth charts, retrospective outcomes, and 2026 grades are not
evidence. `graded_at` records the real build date; `as_of` is the historical cutoff.

The cohort is the top 200 QB/RB/WR/TE players by minimum standard, half-PPR, or
PPR ADP in the existing 300-player archive. K/DEF are excluded per the rubric.
This archive's ADP and projections were fetched after the season and are NOT
certified preseason inputs; its team fields had also drifted to later rosters.
Graded players' teams are replaced with the researched cutoff-date team. The
100 ungraded rows keep their original metadata and null grades.

`graded-01.json` through `graded-04.json` contain the sub-agent research and
source publication dates. `evidence_status: conservative_default` explicitly
identifies evidence gaps: a default is not proof of health or a secure role.
Individual numeric estimates remain judgments, not reported facts. Do not
describe all 200 records as fully source-verified estimates.

`team-offense.json` supplies one deterministic score per historical team using
a dated preseason offensive-efficiency forecast as a proxy for scoring
environment. Its rank bands follow the grading rubric. Batch `offense_raw`
values are preserved for audit, but are NOT consumed by the backtest. The
normalized value and its independent source are embedded into every grade.

Build: `npm run historical:grades`. Check: `npm run historical:grades -- --check`.
The offline builder rejects missing/duplicate cohort IDs, invalid ranges,
missing evidence status, unknown teams, and invalid/post-cutoff source dates.
These checks validate metadata, not whether a source actually supports a claim.
The backtest receives numeric grades and availability only; source prose and
actual weekly results are never passed into the draft strategy.

The original archived projection/ADP caveat remains. Without immutable dated
snapshots and independently blinded grading, this dataset cannot be certified
free of all hindsight. Use it as an explicitly qualified backtest input, not
as a clean out-of-sample validation set. No grade was tuned to backtest results.
