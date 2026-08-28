# Replacement baseline experiment continuation

Branch `algo/baselines`; worktree `.claude/worktrees/agent-a740e49193fd91e4e`.

## Recovered Claude experiments

The original log did complete TE and heldout experiments; initial handoff omitted its final queue batch. All values below are official backtest average points ± pooled standard error, n=96 seed/seat trials. Discovery seeds 1–8, heldout seeds 9–16. Baseline 1896.4±9.5 discovery; 1893.6±7.9 heldout. Shared scratch outputs were inspected against the original conversation, not rerun blindly.

| Variant | Discovery | Heldout |
|---|---:|---:|
| Starter demand QB/RB/WR/TE, FLEX shares .667 |1842.9±6.9|—|
| Starter demand, FLEX shares RB .9 WR 1 TE .1 |1838.5±9.2|—|
| Best projected undrafted player (wire), all non-streamable positions |1912.8±9.5|1905.4±8.4|
| Wire RB/WR/TE only |1896.7±9.9|—|
| Wire QB only |1911.7±9.1|—|
| Second-best undrafted player |1914.2±9.4|—|
| Third-best undrafted player |1903.2±10|—|
| Starter demand RB/WR only, FLEX .667 each |1836.3±7.7|—|
| Starter demand RB/WR only, FLEX .9/1 |1785.4±8.2|—|
| Starter demand QB only |1910.8±9.1|—|
| Wire QB+TE |1946.6±7.5|1929.6±7.5|
| Wire TE alone |1912.8±8.5|—|
| Queue by expected injury demand, excludes FLEX |1946.2±7.8|1950.1±6.3|
| Queue by expected injury demand, FLEX .667 each |1903.0±8.9|1904.1±6.8|

Queue definition: for QB/RB/WR/TE use the projected-points-ranked undrafted player's rank `max(1, round(teams * startingSlots * (1 - defaultAvailability)))`, leaving K/DEF unchanged. Fixed starting slots were QB1/RB2/WR2/TE1. Those hardcoded slots are a production limitation in other roster formats, and must not ship unexamined. Wire/demand tests were controlled by experimental process.env switches, also not production changes.

Hypothesis verdict: raising RB/WR replacement to starter demand does not fix the board; it makes results much worse and encourages TE hoarding. Gains concentrate in QB/TE modeling, not the initial presumed RB/WR asymmetry. Queue improvement is highly sensitive to whether FLEX demand is included, making overfit a concern. Only one season is available; holdout seeds vary the draft rooms, not outcomes or season.

## Continuation

Preserved original experimental source at `/private/tmp/fantasy-baselines-original-experiment.js`. Repro runner `/private/tmp/fantasy-baselines-run.mjs` imports the unchanged historical fixture, scoring, and draft APIs; only strategy receives existing preseason fields. Additional experimental `BASELINE_BUP=0` disables flat bench upside. Running queue+BUP0 for seeds1–16; paired comparison uses independently validated BUP0 results from bench worker. Duplicate BUP0 control was canceled after seed1 to conserve CPU (matched 1988.1).

Command (from this worktree):

```sh
env BASELINE_BUP=0 BASELINE_MODE=queue node /private/tmp/fantasy-baselines-run.mjs /private/tmp/fantasy-baselines-queue-bup0.json
```

No evaluation, policy, archived data or bin/backtest files changed.

Verification: `npm test` completed 28/28 passing with experimental switches left at their default current behavior. No assertions changed. Queue+BUP0 loses every first seven discovery rooms; per parent direction stop after discovery8 and do not spend more validating a losing interaction. Original queue heldout was already completed by Claude.

## Final decision: do not merge baseline strategy

Queue+BUP0 discovery: 1977.5 ±9.2 (n=96), versus BUP0 2004.6±7.4. Per-seed candidate: [1948.7, 2005.6, 1919.8, 1992.8, 2017.3, 1941.7, 1958.1, 2036.3]. Per-seed BUP0 control: [1988.1, 2018.1, 1969.8, 2007.6, 2027.3, 1993.5, 1998.7, 2033.9]. Paired seed-mean deltas: [-39.4, -12.5, -50.0, -14.8, -10.0, -51.8, -40.6, 2.4]. Mean paired delta -27.1 ±7.3 points (SE across 8 room means; computed from rounded displayed seed values). Seven of eight rooms lose. This does not improve the selected bench fix.

Restored js/value.js to exactly its pre-continuation experimental state; original uncommitted baseline switches are preserved, not a proposed merge. No commit produced because no production change is justified. Evidence and original outputs live in /private/tmp; parent can aggregate into PR documentation.

Cancellation caveat: seed9 completed between the seed8 output poll and interrupt (1998.1). JSON contains that incidental seed, but all comparisons above explicitly use discovery seeds1–8; no completed heldout comparison is claimed.
