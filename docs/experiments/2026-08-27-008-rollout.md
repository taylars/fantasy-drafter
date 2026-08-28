# Rollout experiment — resumed 2026-08-27

## Integrity and recovered trials

Only js/value.js strategy code changed; scoring/evaluator, scripted opponent policy and data untouched. Strategy reads preseason projections, grades, ADP and roster state only. Saved original dirty source is `value-at-pause.js`; resumed snapshots live in `resumed/`. Only 2025 outcomes exist; room seeds are not independent seasons. Standard errors over draft observations understate shared-season uncertainty; seed-cluster errors also reported.

Original results (96 drafts, seeds1–8), before removal of bench bonus:

| Variant | Points ±SE | Seconds | Interpretation |
|---|---:|---:|---|
| Production tree ahead4 |1896.4 ±9.5|203.3–227|baseline|
| Tree ahead1 |1802.9 ±8.7|14|worse|
| Tree ahead2 |1857.9 ±9.1|22|worse|
| Tree ahead3 |1873.3 ±8.5|69|worse|
| Tree ahead5 |1912.5 ±10.4|1087|+16.1 at ~4.8x cost; reject cost|
| Greedy full rollout |1882.4 ±9.7|not recovered|worse|
| Uniform16 full rollout |1909.7 ±7.5|71.0|small gain|
| Uniform48 full rollout |1921.3 ±6.9|143.7|best defensible recovered full-depth variant|
| Rollout ahead4 |1836.6 ±9.3|33.4|worse|
| Rollout ahead6 |1868.3 ±11.5|37.7|worse|
| Rollout ahead8 |1913.3 ±9.2|23.0|variant sweep; confounded timing|
| Rollout ahead11 |1899.9 ±8.2|57.6|variant sweep; confounded timing|

Per-seed original numbers and exact dumps are retained in `resumed/r_*.log` / `d_*.json`. The saved pause source included a subsequent stratified position-draw patch with no saved validation; resumed candidate removes that patch using the exact original log edit, not guesswork. Tree-exact switch also never selected. No broad retuning resumed.

## Fixed candidate against selected BUP0 baseline

Uniform-position rollout, 48 independent shared-room samples, width5 players/position, ahead15. Only additional BUP0 adjustment. A 24-draft screen was inconclusive (+13.7 ±14.0), but runtime14.7s warranted completing cheap fixed discovery evaluation. Control tree24 exactly reproduced saved BUP0 points, 2003.1 ±15.4 in24.3s. Existing28tests pass with BUP0 tree.

| Dataset | BUP0 | Rollout+BUP0 | Paired delta | Better drafts | Seed-cluster SE |
|---|---:|---:|---:|---:|---:|
| Discovery seeds1–8 |2004.6 ±7.4|2033.3 ±6.9|+28.7 ±6.3|68/96|6.9|
| Heldout seeds9–16 |2005.0 ±7.7|2039.5 ±6.6|+34.6 ±6.1|69/96|5.6|

Discovery7/8 seed means improve; heldout8/8 improve. Full per-seed candidate and delta numbers are in `resumed/analysis.json`. Discovery runtime63.3s (two processes sequential), heldout57.4s; host contention means cross-run timing is directional, not rigorous browser latency. Favorable to shallow tree in this harness.

Commands, from worktree root:

```
ROLLOUTS=48 node tmp-sweep.mjs --seeds=1,2 --ahead=15 --dump=handoff-artifacts/resumed/bup0-rollout48-seeds12.json
ROLLOUTS=48 node tmp-sweep.mjs --seeds=3,4,5,6,7,8 --ahead=15 --dump=handoff-artifacts/resumed/bup0-rollout48-seeds38.json
ROLLOUTS=48 node tmp-sweep.mjs --seeds=9,10,11,12,13,14,15,16 --ahead=15 --dump=handoff-artifacts/resumed/bup0-rollout48-seeds916.json
PLANNER=tree node tmp-sweep.mjs --seeds=1,2 --ahead=4 --dump=handoff-artifacts/resumed/bup0-tree-seeds12.json
PLANNER=tree npm test
python3 handoff-artifacts/resumed/analyze.py
```

Reproduction requires copying the corresponding source snapshot into js/value.js; candidate snapshot is `resumed/value-candidate.js`. Original harness retained at `resumed/sweep-at-resume.mjs` (run from root after copying). No experimental environment switches should ship.

## Combination gate (in progress)

Parent selected fixed ceiling heuristic from sibling. One fixed combo on seeds9–16 compares directly to saved ceiling-only results; no additive-gain assumption. Snapshot `resumed/value-combo.js` incorporates sibling minimal patch. Acceptance/production cleanup and sanity checks depend on combo outcome. If shipped, board/backtest shared horizon becomes15 while separate exponential explanatory plans() remains4; do not accidentally increase that explorer to15.

Combo heldout complete: 2058.9 ±7.3 vs ceiling-only 2038.2; paired +20.7 ±5.3, wins68/96, seedcluster SE6.0;64.4s. Preparing clean candidate and bounded cross-format sanity before parent acceptance.


## Cross-format gate (fixed expansion running)

A seed17 screen of three seats/config against ceiling-only produced −27.5 (10team classic halfPPR), +49.5 (14team double-flex halfPPR), −14.7 (12team three-WR standard/mixed), −29.6 (12team double-flex PPR/mixed). Candidate runtime~0.6× control across all four. Small sample and one −138.5 outlier; fixed additional seeds18–20 for the exact same configs/seats are the final gate, no tuning or subsequent expansion. If losses persist, defer rollout despite default-room gain and speed. `sanity-analysis.json` records every seat result.

Commands: `ROLLOUTS=48 node tmp-resume-sensitivity.mjs 15 18,19,20` and `PLANNER=tree node tmp-resume-sensitivity.mjs 4 18,19,20` with combo snapshot active. Evaluator/config definitions unchanged.


### Code review limitations (confirmed)

`greedyPick` samples a roster-eligible position before checking whether any player at that position survived the sampled room. If none survive, it returns null and the entire rollout breaks, even when other positions still have players. This can truncate modeled trajectories and undervalue continuation. `mustFill` also uses the remaining bounded horizon (`picks.length-j`), so ahead15 incorrectly treats that horizon as the whole remaining draft when leagues have more than15 rounds. All completed experiments use15-round rosters, so the long-draft issue was not exercised. This is a research candidate, not production-ready merely because default-room results improve. No unmeasured fix or new sweep is being slipped in. If shipped after further work, bestPlan must be labeled maximum sampled continuation, not true/exhaustive optimum; separate exponential `plans()` must remain at4, and board/backtest defaults must match15.


## Final verdict: deferred, do not merge rollout

Default15-round evidence is promising: BUP0 rollout +28.7 discovery/+34.6 heldout, ceiling+rollout another +20.7 heldout versus ceiling alone, and roughly0.6× tree runtime. However the fixed cross-format expansion keeps a10-team/classic regression in every seed, PPR remains uncertain, and trajectory truncation / long-draft horizon semantics are correctness limitations. Parent explicitly chose bench+ceiling only. No further tuning, no production implementation commit, no PR/push from this agent.

Final cross-format results versus ceiling-only, seeds17–20, seats1/middle/last (12drafts/config):

|Config|Paired delta ±SE|Wins|Per-seed mean deltas17/18/19/20|
|---|---:|---:|---|
|10teams half_ppr adp|-31.5 ±20.7|2/12|-27.5, -60.7, -25.7, -12.2|
|14teams half_ppr adp|+59.3 ±20.7|9/12|+49.5, +72.1, +38.7, +77.0|
|12teams std mixed|+10.3 ±10.1|8/12|-14.7, +35.3, +35.3, -14.9|
|12teams ppr mixed|-7.4 ±18.2|8/12|-29.6, +38.4, +10.8, -49.2|

All raw paired numbers/configs/timings in resumed/sanity*-*.json. Four configurations alter multiple axes, so this is a sensitivity check, not attribution to league size or format. Reused2025 outcomes remain a one-season limitation. Candidate48/width5/ahead15 was fixed throughout resumed validation; no result-dependent tuning.

### Future bounded work (not performed)

1. Choose only roster-eligible positions with surviving sampled players; avoid ending an otherwise viable trajectory on an unavailable random position.
2. Separate actual remaining draft picks from bounded lookahead when forcing roster completion; test >15round leagues.
3. Keep board/backtest shared bounded15 default but explanatory exponential plans() at4; remove all experiment environment switches and dead tree code only after revalidation.
4. Revalidate fixed corrected candidate against bench+ceiling with fresh rooms and broader configs, without outcome inputs or scoring changes; verify browser per-pick latency and deterministic repeated boards. Label bestPlan as best sampled continuation, not exhaustive optimum.

Original dirty js/value.js restored exactly from value-at-pause.js after completion; resumed pure-rollout and combo source snapshots preserve measured code. Original scratch files untouched. Only notes/artifacts are committed. Existing28tests passed on BUP0 tree control, not a production rollout implementation. Every launched command completed; no experiment subprocess is left by this agent.
