# Historical seasons

Each season is self-contained and keeps information available at draft time
physically separate from information learned afterward:

```
data/historical/<season>/
  draft.json
  weeks/
    week-01.json
    week-02.json
    ...
```

`draft.json` contains the capture timestamp, source, scoring definitions, ADP,
projections, and the player grade available for that season. A null grade means
no grade was created; another season's grade must never be substituted.

Each weekly file contains only that week's actual points, keyed by player ID
and scoring format. One week per file lets an incomplete or corrected week be
updated without rewriting the season. Draft simulations read only `draft.json`;
the scorer receives the weekly files after the simulated draft is complete.

2025 is a completed backtest season. Its archived projection records were
fetched after the season and carry that caveat in `draft.json`; no 2025 grades
exist. 2026 was captured before the season with the researched 2026 grades.
Add its week files as results become available.

Capture a draft snapshot with
`npm run historical:draft -- --season 2026`. Add or replace one result with
`npm run historical:week -- --season 2026 --week 1`.
