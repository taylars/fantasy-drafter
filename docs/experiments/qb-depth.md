# QB depth continuation

## Historical experiments recovered from the full Claude subagent log

Worktree `agent-abf974b668f41c1af`, branch `algo/qb-depth`, baseline commit `8f691ba`. The initial handoff understated this agent: it completed six measurements, not merely setup.

All original runs: production ahead=4 / board limit=250, seeds1–8, 96 seat/seed drafts. ± denotes standard error across seat/seed drafts (not independent seasonal evidence).

| Variant QB/TE depth | Points ±SE | Paired delta vs baseline ±SE |
|---|---:|---:|
| 1 / 1 baseline | 1896.4 ±9.5 | — |
| 2 / 1 | 1915.3 ±8.0 | +18.8 ±5.9 |
| 2 / 2 | 1922.9 ±7.7 | +26.4 ±5.8 |
| 1 / 2 | 1910.1 ±9.4 | +13.6 ±5.6 |
| 3 / 1 | 1844.3 ±11.8 | -52.1 (SE not recorded) |
| 1.5 / 1.5 | 1947.2 ±7.8 | +50.8 ±4.3 |

Per-seed points (1–8):
- Baseline: 1869.3,1899.1,1851.5,1895.3,1921.7,1888.7,1902.8,1943.2.
- QB2: 1897.8,1907.3,1885.0,1902.1,1962.9,1905.8,1920.0,1941.3.
- QB2/TE2: 1909.8,1915.5,1888.1,1909.4,1971.2,1913.3,1923.9,1951.9.
- TE2: 1885.1,1891.7,1877.2,1910.3,1972.8,1878.0,1917.7,1947.5.
- QB3: 1838.9,1827.2,1827.3,1836.4,1897.8,1863.7,1827.1,1835.8.
- QB1.5/TE1.5: 1921.0,1966.7,1910.3,1946.0,1982.3,1928.0,1943.0,1980.3.

Mechanism: QB2 drafts exactly two QBs, raises QB scoring 252.9→297.4, reduces QB replacement starts 5.5→3.7, but loses TE/DEF production. QB3 improves QB to317.1 but costs too much elsewhere. Fractional depth raises QB scoring to310.0 and replacement starts to2.9; that tuning does not constitute an independent fix unless it survives the simpler removal of the duplicated bench upside premium.

## Continuation design

Do not repeat completed sweeps. Retain original diagnostic harness importing unchanged backtest/data. Temporarily set BENCH_UPSIDE_POINTS=0 and test strongest fractional variant QB=TE=1.5 on training seeds1–8 and unseen room seeds9–16. Compare to bench worker BUP0 baseline for the same seed+seat. This is room holdout only; the NFL season remains 2025 and archived projections are not a provable August snapshot.

Commands from this worktree:
```
DEPTH_OVERRIDE='{"RB":3,"WR":3,"QB":1.5,"TE":1.5,"K":1,"DEF":1}' node diag.mjs --strategies=board --seeds=1,2,3,4,5,6,7,8 --dump=/private/tmp/fantasy-qb15-bup0-train.json
DEPTH_OVERRIDE='{"RB":3,"WR":3,"QB":1.5,"TE":1.5,"K":1,"DEF":1}' node diag.mjs --strategies=board --seeds=9,10,11,12,13,14,15,16 --dump=/private/tmp/fantasy-qb15-bup0-holdout.json
node pair.mjs /tmp/base.json /tmp/qb15te15.json
```

The last command confirms original fractional depth +50.8±4.3, improved78/96 seats; per-seed deltas+51.8,+67.6,+58.9,+50.7,+60.6,+39.3,+40.2,+37.2. Original dump means were checked against transcript before reuse.

## Continuation results and verdict

**Reject the independent depth change.** Fractional QB/TE depth improves the old policy but regresses after removal of the duplicate bench upside bonus. Do not combine it with BUP0.

| Seeds | BUP0 alone | BUP0 + QB1.5/TE1.5 | Difference |
|---|---:|---:|---:|
| Training 1–8 | 2004.6 ±7.4 | 1991.7 ±7.4 | -12.9 |
| Room holdout 9–16 | 2005.0 ±7.7 | 1990.2 ±8.2 | -14.8 |

BUP0 comparator above is the original bench-agent measurement, being independently reproduced by the bench worker. Fractional+BUP0 figures are freshly measured in this continuation. Full per-seat paired SE awaits that worker's points dump; paired across the eight training seed means is -12.9 ±4.1, with seven of eight seeds worse. Do not treat the unpaired pooled SEs as SE of the difference.

Training per-seed: 1961.5,2014.2,1949.0,1996.0,2023.8,1981.1,1970.6,2037.3. Paired seed deltas vs original BUP0: -26.6,-3.9,-20.8,-11.6,-3.5,-12.4,-28.1,+3.4.
Holdout per-seed9–16: 2004.3,1982.6,1946.8,2011.2,1944.9,2058.7,1959.6,2013.4.

Training position points: QB313.5 RB701.5 WR438.2 TE267.9 K176.6 DEF94.0; holdout QB311.7 RB698.1 WR443.1 TE267.8 K176.6 DEF92.8. Training QB replacement starts2.2; holdout2.5. Both draft2.0 QBs/team, so raising artificial slot demand is unnecessary to obtain backup QBs once the bench premium is fixed.

No strategy commit. The worktree's original dirty js/value.js (DEPTH_OVERRIDE experimental hook, BUP10) and original diag.mjs/pair.mjs are preserved exactly. Only the temporary BUP0 continuation edit was undone. No measuring-stick/data/policy changes were made. `npm test` passed (28/28) on restored baseline source; stdout `/private/tmp/fantasy-qb-tests.log`. Reproduce continuation by setting BUP constant to0 temporarily before the listed commands. JSON and logs retained at `/private/tmp/fantasy-qb15-bup0-{train,holdout}.{json,log}`.

Stop here, per wrap-up request: no further fractional tuning, no BSS interaction sweep, no standalone depth merge.

