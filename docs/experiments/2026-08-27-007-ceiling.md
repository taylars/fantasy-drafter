# Projection-spread experiment (2026-08-27)

## Decision and scope

Accept a fixed additive projection-spread preference with weight .5, alongside
the separately accepted removal of the flat bench upside bonus. This is an
uncalibrated strategy heuristic, not a weekly win-probability model. No policy,
evaluator, opponent, or data changes; no realized outcomes enter strategy.

## Evidence

| Comparison | Candidate mean points | Change vs control |
| --- | ---: | ---: |
| Original risk -.5, seeds1–8,96 seats |1944.5|+48.1 vs original1896.4|
| Common CV .6 ablation,96 seats |1923.3|+26.8 ±6.7 paired SE|
| Bench fix + spread, seeds1–8,96 seats |2047.4|+42.7 ±5.7 paired SE vs bench fix|
| Bench fix + spread, heldout seeds9–16,96 seats |2038.2|+33.2 ±6.5 paired SE vs bench fix|
| Expanded PPR seeds9–10,24 seats |2237.2|+10.5 ±9.0 paired SE vs2226.7|

All eight discovery and all eight heldout seed averages improve against the
bench fix. Heldout all-play65.5%, weekly highs17.7%, playoffs77.1%, champions56.3%.
The original three-seed risk sweep tried0,.15,.5,1.5,-.5,-1.5; -.5 and -1 were
confirmed on eight seeds (1944.5 and1939.0). Risk and ceiling knobs in the
experiment are algebraically redundant; only fixed -.5 was continued, which
becomes positive .5 in production. No later tuning or scoring-format guards.

Seed17 seats1/6/12 sensitivity deltas versus bench fix: classic+9.0,threeWR+45.0,
standard0,PPR-11.3,mixed+15.9. The PPR loss motivated the fixed expanded check:
seed9+21.06 and seed10 unchanged. Championship/overall grade metrics do not
universally improve. The common-CV ablation retains only about half of the
original gain, suggesting a positional/projection tilt rather than validated
weekly distribution estimation.

## Limitations

Only2025 outcomes are available. Rooms/seats reuse players and a single NFL
season; paired standard errors do not measure uncertainty over future seasons.
Held-out room seeds are not held-out seasons. CVs (QB.33,RB.55,WR.60,TE.65,K.45,
DEF.70) and upside multiplier1+.06×max(0,upside) are assumptions. Summed variance
proxies ignore correlations. The term rewards squared projection and respects
the existing depth-demand coverage, which can exceed literal starting slots.

## Verification

`npm test`:30/30 passing, including covered FLEX/wire behavior and ignoring
stale experimental sigma caches or outcome fields. Fresh cleaned production
seed9 seats1/6/12 exactly reproduced saved old-knob totals1999.77,2127.16,2095.44.
A small same-process draft timing check across those seats measured3.551s for
the candidate versus3.033s for bench fix (~17% slower); this is a runtime
sanity check, not a benchmark. Mutable risk/ceiling/flat-CV controls and the
second player cache were removed; strategy remains browser-compatible.

Branch handoff artifacts preserve the old sweep source, raw compressed room
results, sensitivity and expanded PPR JSON, test logs and detailed run history.

Coverage allocation retains the existing adjusted-mean ordering, including
FLEX. It does not jointly optimize mean plus spread across possible lineups.
