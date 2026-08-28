# Opponent room simulation continuation

## Verdict (pending final discovery run)
Original session `agent-ac4384ffa2c585741`, branch `algo/room-sim`, worktree `.claude/worktrees/agent-ac4384ffa2c585741`. Full original log transcribed to `/private/tmp/fantasy-room-original-log.txt`. All original result artifacts copied to `/private/tmp/fantasy-room-validation/`. Original dirty `js/value.js` preserved as `value.original.js`; no experiment code committed.

## Hypothesis and original work
Replace independent analytic ADP survival with 64 generic room simulations from ADP, roster slots, and prior picks. Perceived ranks use ADP Gaussian noise; reach by12 for unfilled starter needs, penalize stocked positions by60, inspect24 candidates. Empirical survival feeds existing search. No scripted opponent code imported/read/reimplemented by this continuation. Only `js/value.js` temporarily changed.

Original agent completed baseline,64-run simulation, no-needs ablation,256-run ablation,28 passing tests, and sanity probe; then monthly budget stopped final analysis/commit. Original apparent gain changed45/96 rosters but12 scores, concentrated in seats1/6; across12 seat means +6.5±5.7(t1.14).

|Original trial|Points ± pooled SE|Paired delta ± SE|Runtime seconds|
|---|---|---|---|
|base.json|1896.4 ±9.5|+0.0 ±0.0|263.7|
|sim64.json|1902.9 ±10|+6.5 ±2.6|294.1|
|noneeds.json|1884 ±8.5|-12.4 ±4.0|138.5|
|runs256.json|1898.6 ±9.6|+2.1 ±3.4|289.0|

Original per-seed average points (seeds1–8):

- base.json: 1869.3, 1899.1, 1851.5, 1895.3, 1921.7, 1888.7, 1902.8, 1943.2
- sim64.json: 1869.3, 1898.1, 1864.7, 1904.3, 1927.4, 1895.3, 1911.9, 1952.6
- noneeds.json: 1850.1, 1898.0, 1841.0, 1878.9, 1911.9, 1872.6, 1884.0, 1935.8
- runs256.json: 1858.8, 1897.0, 1856.0, 1902.0, 1931.0, 1888.6, 1902.5, 1952.6

## Commands and preserved artifacts
All worktree commands run in the room worktree. Original: `npm run backtest -- --seeds=1,2,3,4,5,6,7,8`; `node tmp-probe/dump.mjs tmp-probe/{base,sim64,noneeds,runs256}.json` (each variant selected in source); `npm test`. Original no-needs set ROOM_NEED_BONUS and ROOM_STOCKED_PENALTY to0;256 variant changed ROOM_RUNS only.

Continuation: preserved original source, then changed only BENCH_UPSIDE_POINTS10.0→0. `node tmp-probe/dump.mjs /private/tmp/fantasy-room-validation/bup0-room64.json`; `npm test > /private/tmp/fantasy-room-validation/tests.log 2>&1` (28/28 pass,15.7sec). Control is `/private/tmp/fantasy-bench-validation/bup0/results.json`, discovery2004.6±7.4; compare seed/seat matched `points` field to room `rows.total`. Room dump rounds totals to0.1; paired deltas accordingly have <0.05 rounding error.

## Caveats
- Pooled errors treat drafts as observations although repeated seats/seeds are correlated; one season plus after-season archived projections cannot establish preseason generalization.
- Runtime measurements occurred under differing parallel workloads; original full CLI timings115.0sec baseline /250.3sec room and dump263.7/294.1sec disagree in ratio, so no clean browser latency claim is justified.
- Simulation supplies marginal survival probabilities; existing wait/search still multiplies marginals independently, so advertised joint coupling is not actually retained downstream.
- Inferred seat ownership relies on gone Set insertion order and no traded picks. Simulated future room skips hero picks, hence does not condition on specific hero selections. No late redesign or tuning attempted.
- Original sanity probe showed past-ADP players near0 survival, but “17 at most” top40 survivor assertion in log is not a valid bound: other picks can be outside top40, and hero picks are skipped.
