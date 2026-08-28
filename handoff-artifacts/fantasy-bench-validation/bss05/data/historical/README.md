# Historical seasons

Each season is self-contained and keeps information available at draft time
physically separate from information learned afterward:

```
data/historical/<season>/
  draft.json
  grades.json
  weeks/
    week-01.json
    week-02.json
    ...
```

`draft.json` contains capture provenance, scoring definitions, ADP, projections,
and a reference to the season's `grades.json`. It does not duplicate grades.
`grades.json` is the sole editable source for that season's player grades and
research provenance. Missing IDs are ungraded, never filled from another year.

`index.json` lists available years. The live app and CLI use the newest numeric
year; backtests explicitly use their own season. Register new seasons in this
index. `npm run grades -- check --all` validates index coverage and every season
without network access or writes. Edit grades directly; no build is necessary.

Each weekly file contains that week's actual points, keyed by player ID
and scoring format, plus archived projections and historical injury inputs
when enriched with `node bin/historical-week-inputs.mjs --season=YYYY --week=N`.
Run enrichment after capturing or replacing the actual week. The backtest
requires it for projection-based starter selection and top-ten undrafted,
same-position injury replacement scoring. Source URLs and projection update
timestamps are retained; the archives are not guaranteed pre-kickoff snapshots.
One week per file lets an incomplete or corrected week be
updated without rewriting the season. Draft simulations read only `draft.json`
and the same season's `grades.json`;
the scorer receives the weekly files after the simulated draft is complete.

2025 is a completed backtest season. Its archived projection records were
fetched after the season and carry that caveat in `draft.json`. Retrospectively
reconstructed 2025 grades are maintained in `2025/grades.json`; they are not
grades captured in 2025. Source-date checks do not prove webpage immutability
or eliminate model hindsight. See `2025/GRADING.md` for the evidence limits.
2026 was captured before the season with the researched 2026 grades.
Add its week files as results become available.

Capture a draft snapshot with
`npm run historical:draft -- --season 2026`. Add or replace one result with
`npm run historical:week -- --season 2026 --week 1`.

`npm run historical:grades` remains a shortcut to check 2025 grades, not rebuild
them. Neither capturing a draft nor updating weekly inputs rewrites grades.
