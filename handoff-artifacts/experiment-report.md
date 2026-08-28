# Bench-option experiment

## Decision

Keep the simpler removal of the flat upside-grade bench bonus (BUP=0).
Retain the original 0.02 share of above-wire adjusted projection. No evaluator,
policy or data changes. Upside still enters the adjusted preseason projection.
BSS=.05 scores higher in this one-season sample, but is an additional tuned
coefficient and nearby .08/.15 values deteriorated markedly. Prefer the large,
mechanically justified gain without fitting another coefficient.

## Original Claude trials (recorded, not all rerun)

All discovery trials used seeds 1–8, 12 seats/seed, production ahead=4 and
board limit=250. HOLDOUT labels use seeds 9–16. ± is the evaluator's pooled
seat-run standard error, not uncertainty across seasons. BUP is flat grade
points, BOW is above-wire share, BSS is upside times above-wire share, BDD is
per-position extra-depth decay. Unspecified BUP=10, BOW=.02, BSS=0, BDD=1.
An initial shared probe was overwritten; use the identity control and uniquely
named probe results below. The identity control exactly reproduces baseline.

```
ctl-identity: points 1896.4 ±9.5 (n=96)  score 76.1  finish 5.05  allPlay 55.1%  playoffs 50%  champs 25%
A-BDD0.5: points 1897.5 ±9.4 (n=96)  score 76.5  finish 4.98  allPlay 55.3%  playoffs 52.1%  champs 27.1%
C-BDD0.0: points 1970.4 ±8.9 (n=96)  score 83.7  finish 3.3  allPlay 60.6%  playoffs 68.8%  champs 49%
D-BUP5: points 1897.1 ±9.6 (n=96)  score 75.8  finish 5.11  allPlay 55.2%  playoffs 49%  champs 26%
E-BUP0: points 2004.6 ±7.4 (n=96)  score 85.5  finish 2.64  allPlay 62.3%  playoffs 76%  champs 44.8%
F-BUP0-BSS0.15: points 1966.2 ±9.8 (n=96)  score 82.1  finish 3.49  allPlay 59.6%  playoffs 67.7%  champs 34.4%
G-no-option-at-all: points 1977.2 ±8 (n=96)  score 84.5  finish 3.03  allPlay 60.8%  playoffs 69.8%  champs 50%
H-BUP1: points 1955.5 ±8.1 (n=96)  score 82.3  finish 3.41  allPlay 59.3%  playoffs 62.5%  champs 43.8%
I-BUP2: points 1961 ±9.1 (n=96)  score 82.7  finish 3.45  allPlay 59.7%  playoffs 69.8%  champs 44.8%
J-BUP3: points 1958.5 ±9.2 (n=96)  score 81.7  finish 3.54  allPlay 59.2%  playoffs 63.5%  champs 40.6%
K-BUP0-BOW0.05: points 2005.1 ±7.5 (n=96)  score 85.5  finish 2.64  allPlay 62.3%  playoffs 76%  champs 44.8%
L-BUP0-BOW0.2: points 1980.3 ±8.5 (n=96)  score 83.9  finish 3.08  allPlay 60.5%  playoffs 69.8%  champs 47.9%
M-BUP0-BOW0.01: points 2004.6 ±7.4 (n=96)  score 85.6  finish 2.64  allPlay 62.3%  playoffs 76%  champs 44.8%
N-BUP0-BOW0.1: points 1994.5 ±8.9 (n=96)  score 86.1  finish 2.79  allPlay 62.2%  playoffs 80.2%  champs 55.2%
O-BUP0.5: points 1955.6 ±7.9 (n=96)  score 82.3  finish 3.38  allPlay 59.1%  playoffs 62.5%  champs 42.7%
P-BUP0-BSS0.02: points 2012.3 ±7.4 (n=96)  score 86.2  finish 2.48  allPlay 63%  playoffs 79.2%  champs 46.9%
Q-BUP0-BSS0.05: points 2017.7 ±7.9 (n=96)  score 86.1  finish 2.45  allPlay 63.2%  playoffs 77.1%  champs 44.8%
R-BUP0-BOW0.05-BDD0.5: points 2013.5 ±7.6 (n=96)  score 86.1  finish 2.47  allPlay 62.8%  playoffs 78.1%  champs 46.9%
HOLDOUT-baseline: points 1893.6 ±7.9 (n=96)  score 76.2  finish 5.01  allPlay 54.7%  playoffs 46.9%  champs 25%
HOLDOUT-E-BUP0: points 2005 ±7.7 (n=96)  score 85.7  finish 2.5  allPlay 62.4%  playoffs 75%  champs 49%
HOLDOUT-Q-BUP0-BSS0.05: points 2024.3 ±7.1 (n=96)  score 87.3  finish 2.17  allPlay 63.9%  playoffs 80.2%  champs 49%
HOLDOUT-P-BUP0-BSS0.02: points 2015.8 ±7.5 (n=96)  score 86.4  finish 2.27  allPlay 63.4%  playoffs 80.2%  champs 46.9%
HOLDOUT-G-no-option: points 1981.4 ±7.3 (n=96)  score 84.8  finish 2.84  allPlay 61%  playoffs 71.9%  champs 47.9%
HOLDOUT-BSS0.08: points 1980.9 ±7.4 (n=96)  score 84.4  finish 2.89  allPlay 61.3%  playoffs 74%  champs 44.8%
```

## Reproduction

`node scripts/experiments/bench-option-check.mjs /absolute/isolated/repo`
loads that checkout's unchanged evaluator/data and writes `results.json` there,
with train/held-out grades, per-seed grades and all paired seat totals.
`node scripts/experiments/bench-option-check.mjs /absolute/isolated/repo --sensitivity`
writes `sensitivity.json` for seed17, seats1/6/12, classic/three-WR/std/PPR/mixed.
Use separate checkouts or copies per variant; never change strategy files under
a running process. The driver does not modify strategy, evaluator or data.

Fresh runs used isolated copies under `/private/tmp/fantasy-bench-validation/`:
- baseline: original `git show HEAD:js/value.js` at 8f691ba base
- bup0: final production implementation
- bss05: BUP0 with option `(0.02 + 0.05 * max(0, upside)) * surplus`

Commands executed: `node /private/tmp/fantasy-bench-validation/run.mjs /private/tmp/fantasy-bench-validation/{baseline,bup0,bss05}`
(one actual command per variant; run.mjs is the standard16-seed form of the committed driver).
Sensitivity used committed driver with each of baseline/bup0 paths and `--sensitivity`.
Final regression gate: `npm test`.

Archived 2025 projections were fetched after the season and cannot be proven
August snapshots. Room seeds vary opponents, not player outcomes; held-out
rooms reuse the same season and therefore do not establish future-season
performance. Sensitivity is deliberately small, not a full matrix.

## Fresh validation (Codex continuation)

| Variant | Seeds1–8 points ± SE | Seeds9–16 points ± SE | elapsed seconds |
|---|---:|---:|---:|
| baseline | 1896.4 ±9.5 | 1893.6 ±7.9 | 194.7 |
| bup0 | 2004.6 ±7.4 | 2005 ±7.7 | 199.2 |
| bss05 | 2017.7 ±7.9 | 2024.3 ±7.1 | 201.8 |

Timing is simultaneous wall time under other agent load, not an isolated browser benchmark. No search-depth or iteration increase was introduced.

| Comparison | Seeds | Paired mean ± seat-run SE | Mean ± seed-cluster SE |
|---|---|---:|---:|
| bup0 − baseline | 1–8 | 108.17 ±5.31 | 108.17 ±3.84 |
| bup0 − baseline | 9–16 | 111.40 ±5.66 | 111.40 ±4.99 |
| bss05 − bup0 | 1–8 | 13.11 ±2.72 | 13.11 ±2.48 |
| bss05 − bup0 | 9–16 | 19.34 ±3.15 | 19.34 ±3.18 |

| Seed | Baseline | BUP0 | BSS.05 |
|---|---:|---:|---:|
| 1 | 1869.3 | 1988.1 | 1993.1 |
| 2 | 1899.1 | 2018.1 | 2031.7 |
| 3 | 1851.5 | 1969.8 | 1988.3 |
| 4 | 1895.3 | 2007.6 | 2013.6 |
| 5 | 1921.7 | 2027.3 | 2051.6 |
| 6 | 1888.7 | 1993.5 | 2002 |
| 7 | 1902.8 | 1998.7 | 2018.1 |
| 8 | 1943.2 | 2033.9 | 2043.4 |
| 9 | 1906.3 | 2015.8 | 2022.8 |
| 10 | 1896 | 2020.3 | 2039.2 |
| 11 | 1866.4 | 1974.9 | 1993.8 |
| 12 | 1909.1 | 2011.7 | 2038.5 |
| 13 | 1857.7 | 1978.5 | 1991.1 |
| 14 | 1911.3 | 2036.2 | 2053.1 |
| 15 | 1906.4 | 1989.1 | 2025.7 |
| 16 | 1895.3 | 2013.4 | 2030.2 |

| Sensitivity (seed17, seats1/6/12) | Baseline | BUP0 | Delta |
|---|---:|---:|---:|
| classic | 1810.9 | 1866 | +55.1 |
| three_wr | 1888.1 | 1953 | +64.9 |
| std | 1720.3 | 1802.9 | +82.6 |
| ppr | 2292.2 | 2336.4 | +44.2 |
| mixed | 1887.4 | 2010 | +122.6 |

Final `npm test`: 29/29 pass; targeted test rerun after cosmetic fixture simplification also passed. `git diff --check` and driver syntax check pass.

Commit: `c7d6560` on `algo/bench-option`. Worktree clean after commit.
