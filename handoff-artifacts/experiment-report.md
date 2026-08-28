# Ceiling / variance experiment continuation

## Scope and original hypothesis
Branch `algo/ceiling`, worktree `.claude/worktrees/agent-a95db20ef16f7dcaf`. Only js/value.js experimental source; evaluator, opponents, data unchanged. Model sums independent weekly variances derived from preseason projection, position CV (QB .33/RB .55/WR .60/TE .65/K .45/DEF .70), and upside multiplier 1+.06*upside. Objective = season mean - risk*17*weekly sigma + ceiling*3*weekly sigma. Ceiling/risk are algebraically interchangeable, not an explicit weekly win probability or playoff model. Configuration defaults zero; experiment is NOT active in production. Original dirty source backed up at /private/tmp/ceiling-original-value.js.

## All original trials
Original three-seed sweep, n=36 each, points ± standard error:

|Risk|Points|All-play %|Weekly highs %|Playoffs %|Championship %|Seconds|
|---|---|---|---|---|---|---|
|0|1873.3 ±14|53.5|10.8|36.1|25|127|
|.15|1857.7 ±13.1|52.4|10.5|36.1|22.2|121|
|.5|1882.9 ±15.7|53.4|10.8|52.8|19.4|74|
|1.5|1883.5 ±16.3|54.2|8.7|58.3|13.9|87|
|-.5|1926 ±12.4|57.4|14.2|58.3|41.7|130|
|-1.5|1940.1 ±11.5|58|13.7|66.7|22.2|96|

Completed eight-seed confirmation recovered from task blkebu8wj.output (not initially reflected in handoff):

|Risk|Points n=96|All-play %|Weekly highs %|Playoffs %|Championship %|Seconds|
|---|---|---|---|---|---|---|
|-.5|1944.5 ±7.7|58.7|14.8|70.8|52.1|230|
|-1|1939 ±6.7|58.4|13.4|68.8|25|159|

Risk -.5 seed points 1–8: 1924.7,1924,1929.4,1947.3,2003.6,1925,1929.5,1972.6.
Risk -1 seed points 1–8: 1921.7,1918.7,1943.4,1933.7,1986.3,1938,1902.5,1967.4.
Original baseline 1896.4 ±9.5 n=96. Baseline repeated only on first three seeds in this branch.

Probe found sigma spread ~.8 among top candidates in rounds3–4 versus value spread7.9–10.4. This term can create strong positional/projection tilts; gains do not validate variance estimates or tournament logic. No actual outcomes enter strategy. Original diagnostic probe imported opponent policy only to recreate draft states, never strategy implementation.

## Fresh bounded continuation
Runner /private/tmp/ceiling-resume.mjs is an independently named copy of original sweep with raw board results persisted. Each run uses fresh process, avoiding stale memoized sigma when configuration changes. Commands run from experiment worktree:

```
CEILING_LABEL=flat node /private/tmp/ceiling-resume.mjs --seeds=1,2,3,4,5,6,7,8 --per-seed --grid=risk:-0.5,flatCv:0.6
```

Pending flat-CV ablation, BUP0 interaction.

### Flat-CV ablation results
Common CV=.6, risk=-.5: **1923.3 ±7.7** n=96, paired delta vs original baseline **+26.8 ±6.7**. Per seed:1903.8,1901.5,1916.0,1925.5,1965.7,1907.2,1915.0,1951.2. Per-seed paired deltas:+34.5,+2.4,+64.5,+30.2,+44.0,+18.5,+12.2,+8.1. All-play57.3%,highs11.8%,playoffs65.6%,champs30.2%. Runtime100s on current machine under concurrent experiments (not comparable to original timings). About half of original ceiling gain survives removing position-CV differences; remaining common-CV term still rewards squared projection, so this is not evidence for an accurate weekly-distribution model.

Original experimental source defaults passed 28/28 tests in fresh continuation (/private/tmp/ceiling-tests.log). Static inspection: no Node/process APIs or actual/weekly outcome fields in strategy, but exported mutable knobs and memoized player sigma require special care if ever productionized. All current runs use separate fresh processes. Standard errors are evaluator sample SEs (and paired sample SEs); 96 room/seat results reuse a single season and are not 96 independent NFL seasons. Heldout room seeds also would not validate a different season.

### BUP0 interaction
Temporary source change BENCH_UPSIDE_POINTS10→0, with risk=-.5 and original position CVs. Command:
```
CEILING_LABEL=bup0 node /private/tmp/ceiling-resume.mjs --seeds=1,2,3,4,5,6,7,8 --per-seed --grid=risk:-0.5
```
**2047.4 ±8.4**, n=96, paired BUP0 gain **+42.7 ±5.7**. Allplay66.2%,highs19.1%,playoffs81.3%,champs58.3%,runtime109s. Perseed2033.0,2025.9,2030.6,2062.2,2091.8,2038.0,2022.4,2075.0. Perseed paired deltas44.9,7.8,60.8,54.5,64.5,44.5,23.7,41.1. These all improve, unlike other hypothesis interactions.

Fresh fixed-parameter heldout9–16 launched because this clears discovery. Original agent selected -.5 and -1 after three-seed exploration; -.5 chosen as stronger8-seed result. No more tuning planned. BUP0 controls come from independently reproduced /private/tmp/fantasy-bench-validation/bup0/results.json, paired by seed/heroSeat. A failed exact-string source replacement briefly launched the non-BUP0 candidate; stopped before result, corrected10.0 literal, relaunched. No result from aborted run used.
