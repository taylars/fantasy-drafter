# rollout — completed, deferred 2026-08-27

Branch `algo/rollout`. User requested stop to conserve credits. Agents interrupted; final process check found no matching experiment subprocesses.

## State

Not resumed by Codex. Original Claude work: greedy full1882.4 loses; uniform1909.7; ahead5=1912.5 at4.8x runtime. Variants confounded, no final validation or merge. Inspect original log and local tmp scripts before continuing.

## Resume

Read handoff-artifacts/experiment-report.md if present, then original-session-audit.md. Source snapshot and dirty patch preserved; this handoff does not approve experimental code. Reports may still say running: output-file existence is not verification. Saved scripts can contain old /private/tmp paths; update paths before rerunning. Preserve evaluator, policy and data. Only2025 outcomes exist; held-out rooms are not held-out seasons.

Shared controls: bench-option worktree handoff-artifacts/fantasy-bench-validation/{baseline,bup0,bss05}/results.json. Original Claude log: ~/.claude/projects/-Users-taylor-larsen-Code-fantasy-drafter/fea0e246-7ebd-4223-8e8e-8f1ab60d4b49/subagents/agent-a2d4ac53697508a42.jsonl.

PR intended algo-improvements into main documenting every success and failure; not opened. User resumed; see final verdict below.

## Resumed 2026-08-27 — recovery decision
Recovered original r_*.log and per-draft dumps into handoff-artifacts/resumed. The 1921.3 result is specifically uniform-position full-depth rollout with 48 independent samples (143.7s), not stratified sampling. Current dirty source had a later unvalidated stratification patch. Restored pre-stratification draws from exact original log patch and changed only BUP to zero for a bounded seeds 1–2 / 24-draft screen, ahead15, ROLLOUTS48, versus saved selected BUP0 controls. No broader parameter tuning planned. Source-at-pause remains preserved.

Seeds1–2 screening: rollout 2016.8 ±13.2 vs BUP0 2003.1; paired delta +13.7 ±14.0, wins 13/24. Runtime14.7s. Seed1 lost7.3, seed2 gained34.6; insufficient consistency, but inexpensive enough to complete discovery seeds3–8 before deciding.

Control verification: current BUP0 PLANNER=tree ahead4 exactly reproduced all24 saved control points (seeds1–2), 2003.1 ±15.4 in24.3s. Rollout screen14.7s; timing is directional only because other experiments may share host load. BUP0 tree npm test passed28/28.

Discovery96 complete: candidate 2033.3 ±6.9; paired gain +28.7 ±6.3; 68/96 wins, 7/8 seed means improve; seed-cluster SE 6.9. Continuing fixed48-sample full-depth candidate to heldout seeds9–16; no tuning.

Heldout96 complete: candidate 2039.5 ±6.6; paired gain +34.6 ±6.1; 69/96 wins; seed-cluster SE 5.6. Runtime57.4s. Parent requests fixed ceiling+rollout combo against ceiling-only, seeds9–16 before production choice. Ceiling patch from sibling /private/tmp/ceiling-production.patch; no tuning.

Combo heldout complete: 2058.9 ±7.3 vs ceiling-only 2038.2; paired +20.7 ±5.3, wins68/96, seedcluster SE6.0;64.4s. Preparing clean candidate and bounded cross-format sanity before parent acceptance.

Cross-format screen seed17,3 seats/config: [(10, 'half_ppr', -27.5), (14, 'half_ppr', 49.5), (12, 'std', -14.7), (12, 'ppr', -29.6)]. Small sensitivity only, not independent validation. Exact per-seat deltas/runtime in sanity-analysis.json.

Decision: negative small sensitivity cells warrant fixed expansion to seeds18–20 across the same four configs/three seats, before production acceptance. No parameter changes.


### Code review limitations (confirmed)

`greedyPick` samples a roster-eligible position before checking whether any player at that position survived the sampled room. If none survive, it returns null and the entire rollout breaks, even when other positions still have players. This can truncate modeled trajectories and undervalue continuation. `mustFill` also uses the remaining bounded horizon (`picks.length-j`), so ahead15 incorrectly treats that horizon as the whole remaining draft when leagues have more than15 rounds. All completed experiments use15-round rosters, so the long-draft issue was not exercised. This is a research candidate, not production-ready merely because default-room results improve. No unmeasured fix or new sweep is being slipped in. If shipped after further work, bestPlan must be labeled maximum sampled continuation, not true/exhaustive optimum; separate exponential `plans()` must remain at4, and board/backtest defaults must match15.

Final fixed expanded sensitivity (seeds17–20,3seats each;12drafts/config):
- 10teams half_ppr: -31.5 ±20.7, wins2/12, per-seed [-27.5, -60.7, -25.7, -12.2].
- 14teams half_ppr: +59.3 ±20.7, wins9/12, per-seed [49.5, 72.1, 38.7, 77.0].
- 12teams std: +10.3 ±10.1, wins8/12, per-seed [-14.7, 35.3, 35.3, -14.9].
- 12teams ppr: -7.4 ±18.2, wins8/12, per-seed [-29.6, 38.4, 10.8, -49.2].


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
