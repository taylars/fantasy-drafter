# Correlation / stacking experiment continuation

## Verdict and provenance
Original branch `algo/correlation`, worktree `.claude/worktrees/agent-aa78ed01a26c1c937`; original uncommitted `js/value.js` preserved unchanged, plus snapshot `/private/tmp/fantasy-correlation/value-original.js`. No strategy commit yet. Original JSONL reviewed fully for actions/results; original paired sweep DID complete before monthly limit, contrary to initial handoff summary.

## Hypothesis and implementation
Add same-team QB/pass-catcher bonus, second-RB penalty, third-pass-catcher penalty, weighted by started projection contributions and preseason offense grades. No realized outcomes or weekly projections enter strategy. Grades and backtest code are unchanged.

## Discovered confound
`coverage` appends a player once for dedicated positional coverage and again for FLEX coverage. `teamEffect` treats these as distinct players. Thus a single RB can collide with himself; a split WR can create a spurious third-catcher penalty; split pass-catcher entries also distort capped stack bonuses. The original improvements cannot be taken as evidence of true same-team diversification.
Synthetic deterministic test: one RB with adjusted projection 200 split into .3 and .5 seasons yields -3.6 collision points at weight .06; the same RB merged to .8 yields 0. Deduplicating by player identity and summing fractions restores 0 for the split RB, while two genuinely distinct RBs still yield -3.6. Additionally, actual final-roster collisions need not occur for a correct penalty to affect decisions: hypothetical future rosters in lookahead can be penalized.

Command: `STACK_W=0 COLL_W=.06 CROWD_W=.03 node /private/tmp/fantasy-correlation/diagnose.mjs`.

## All recovered original sweeps (seeds1–8, n96)
Weights refer to STACK_W, COLL_W, CROWD_W. BASE=0/0/0; sXX=stack only; coll=0/.06/.03; collbig=0/.20/.10; full=.10/.06/.03. ± denotes reported standard error; paired seat-cluster SE is an additional caution about repeated seeds sharing seat/player choices, not a formal population inference.

```text
BASE: 1896.4 ±9.5; paired 0.0 ±0.0; seat-cluster ±0.0; per-seed 1869.3, 1899.1, 1851.5, 1895.3, 1921.7, 1888.7, 1902.8, 1943.2; highs 10%; champs 25%
s05: 1904.1 ±8.7; paired 7.7 ±2.2; seat-cluster ±2.6; per-seed 1877.0, 1907.0, 1869.2, 1897.5, 1934.0, 1902.7, 1912.2, 1933.4; highs 10.5%; champs 31.3%
s10: 1908.5 ±8.2; paired 12.0 ±2.6; seat-cluster ±3.2; per-seed 1878.9, 1919.1, 1881.4, 1904.9, 1936.4, 1903.2, 1912.2, 1931.5; highs 10.8%; champs 31.3%
s20: 1903.5 ±11.1; paired 7.0 ±6.9; seat-cluster ±13.9; per-seed 1873.1, 1921.3, 1864.8, 1908.9, 1936.2, 1883.9, 1896.6, 1942.9; highs 12.3%; champs 25%
sneg05: 1895.5 ±9.1; paired -0.9 ±1.9; seat-cluster ±1.9; per-seed 1865.6, 1902.6, 1852.4, 1907.5, 1908.1, 1884.3, 1899.6, 1944.1; highs 10.5%; champs 31.3%
coll: 1911.6 ±10.3; paired 15.1 ±4.7; seat-cluster ±9.5; per-seed 1878.0, 1896.6, 1868.3, 1904.7, 1966.3, 1895.3, 1921.1, 1962.1; highs 10.4%; champs 29.2%
collbig: 1909.2 ±10.4; paired 12.7 ±6.1; seat-cluster ±10.9; per-seed 1866.9, 1881.5, 1872.4, 1910.9, 1978.5, 1898.0, 1921.0, 1944.2; highs 10.9%; champs 28.1%
full: 1918.1 ±8.8; paired 21.7 ±4.7; seat-cluster ±8.9; per-seed 1885.9, 1908.5, 1895.3, 1911.7, 1960.5, 1911.2, 1927.9, 1943.8; highs 10.7%; champs 30.2%
s02: 1896.6 ±9.4; per-seed 1868.7,1896.6,1851.5,1895.3,1921.7,1893.1,1902.8,1943.2; highs9.8%, champs25% (no retained paired row dump).
```

Original commands used scratchpad `sweep.sh "BASE:0:0:0" "s05:0.05:0:0" "s10:0.10:0:0" "s20:0.20:0:0" "sneg05:-0.05:0:0" "coll:0:0.06:0.03" "collbig:0:0.20:0.10" "full:0.10:0.06:0.03"` and earlier stack sweep adding s02. Scratch root `/private/tmp/claude-501/-Users-taylor-larsen-Code-fantasy-drafter/fea0e246-7ebd-4223-8e8e-8f1ab60d4b49/scratchpad`; source scripts inspected before reuse because unrelated siblings overwrote others.

## Bounded BUP0 continuation
An external ESM loader changes only loaded `js/value.js` source, sets BENCH_UPSIDE_POINTS=0, and optionally deduplicates started entries. Original files and evaluator untouched. Clone fixture/dump scripts to private scratch. Baseline per-seat controls come from `/private/tmp/fantasy-bench-validation/bup0/results.json`, independently reproduced all16 seeds.

Exact commands:
```sh
STACK_W=.10 COLL_W=.06 CROWD_W=.03 DEDUP=0 node --experimental-loader /private/tmp/fantasy-correlation/loader.mjs /private/tmp/fantasy-correlation/dump.mjs /private/tmp/fantasy-correlation/original-full.json 1,2,3,4,5,6,7,8
STACK_W=.10 COLL_W=.06 CROWD_W=.03 DEDUP=1 node --experimental-loader /private/tmp/fantasy-correlation/loader.mjs /private/tmp/fantasy-correlation/dump.mjs /private/tmp/fantasy-correlation/fixed-full.json 1,2,3,4,5,6,7,8
python3 /private/tmp/fantasy-correlation/summarize.py
```
Corrected BUP0 variant tests: `STACK_W=.10 COLL_W=.06 CROWD_W=.03 DEDUP=1 node --experimental-loader /private/tmp/fantasy-correlation/loader.mjs --test test/*.test.js` from original worktree: **28/28 passed**, output `/private/tmp/fantasy-correlation/tests.txt`.

One NFL season only; seed holdouts vary opponent rooms, not NFL seasons. Weekly highs/championship noise cannot substantiate a correlation benefit absent robust room and season evidence. Avoid interpreting this additive mean-objective adjustment as a calibrated joint-distribution model.

## Completed discovery continuation

```text
original-full {'score': 86.3, 'letter': 'B', 'averagePoints': 2009, 'pointsStandardError': 7.4, 'samples': 96, 'averageFinish': 2.55, 'pointsPercentile': 85.9, 'allPlayWinRate': 62.3, 'weeklyHighScoreRate': 19.2, 'playoffRate': 69.8, 'championshipRate': 52.1, 'benchContribution': 480.5, 'benchStarts': 43.3, 'positionalPoints': {'QB': 324, 'RB': 679.5, 'WR': 442.4, 'TE': 301.4, 'K': 170.9, 'DEF': 90.8}}
paired 4.4 ±4.0; seat-cluster ±3.7
per-seed 1:1988.4, 2:1997.4, 3:1996.5, 4:2018.1, 5:2040.0, 6:2003.1, 7:2016.1, 8:2012.2
per-seed delta 1:0.3, 2:-20.7, 3:26.7, 4:10.5, 5:12.7, 6:9.6, 7:17.5, 8:-21.6
per-seat delta [17.501999999999953, 0.006249999999965894, -6.388750000000016, -3.467499999999916, -8.34375, 17.08000000000007, 12.764999999999958, 7.152499999999918, -20.49025000000003, 22.91100000000003, 10.189000000000135, 3.5180000000000007]
fixed-full {'score': 86.7, 'letter': 'B', 'averagePoints': 2012.2, 'pointsStandardError': 7.3, 'samples': 96, 'averageFinish': 2.52, 'pointsPercentile': 86.2, 'allPlayWinRate': 62.7, 'weeklyHighScoreRate': 18.3, 'playoffRate': 74, 'championshipRate': 53.1, 'benchContribution': 512.4, 'benchStarts': 44.7, 'positionalPoints': {'QB': 327, 'RB': 676.4, 'WR': 456.1, 'TE': 288.5, 'K': 172, 'DEF': 92.2}}
paired 7.6 ±3.8; seat-cluster ±3.4
per-seed 1:1992.1, 2:2015.7, 3:1991.9, 4:2020.5, 5:2054.6, 6:1998.8, 7:2011.9, 8:2012.4
per-seed delta 1:4.0, 2:-2.4, 3:22.1, 4:12.9, 5:27.3, 6:5.3, 7:13.2, 8:-21.5
per-seat delta [17.501999999999953, 0.006249999999965894, -6.388750000000016, -3.467499999999916, -8.34375, 18.933749999999975, 8.428750000000122, 7.152499999999918, 4.946250000000049, 28.833750000000038, 20.386250000000075, 3.399999999999892]
```
Original buggy full gains shrink to +4.4±4.0 over BUP0; corrected full +7.6±3.8. These do not clear the original >20-point improvement gate. Run exactly one corrected holdout to assess whether apparent championship/highs changes survive seeds9–16; no further tuning or sweeps.

Holdout command: `STACK_W=.10 COLL_W=.06 CROWD_W=.03 DEDUP=1 node --experimental-loader /private/tmp/fantasy-correlation/loader.mjs /private/tmp/fantasy-correlation/dump.mjs /private/tmp/fantasy-correlation/fixed-holdout.json 9,10,11,12,13,14,15,16`.
