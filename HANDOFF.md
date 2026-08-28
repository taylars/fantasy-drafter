# ceiling — completed 2026-08-27

Accepted fixed heuristic candidate; see final verification below. No experiment process remains in this worktree. Original pause record retained for audit.

# ceiling — paused 2026-08-27

Branch `algo/ceiling`. User requested stop to conserve credits. Agents interrupted; final process check found no matching experiment subprocesses.

## State

Paused, promising: BUP0+risk=-.5 scores2047.4, +42.7 discovery. Heldout output exists but parent has not verified it. Next: analyze heldout; small seed17 cross-format checks; only then decide production implementation. Mutable knobs, uncalibrated CV assumptions and runtime require review. Current source may temporarily set BUP0. No merge.

## Resume

Read handoff-artifacts/experiment-report.md if present, then original-session-audit.md. Source snapshot and dirty patch preserved; this handoff does not approve experimental code. Reports may still say running: output-file existence is not verification. Saved scripts can contain old /private/tmp paths; update paths before rerunning. Preserve evaluator, policy and data. Only2025 outcomes exist; held-out rooms are not held-out seasons.

Shared controls: bench-option worktree handoff-artifacts/fantasy-bench-validation/{baseline,bup0,bss05}/results.json. Original Claude log: ~/.claude/projects/-Users-taylor-larsen-Code-fantasy-drafter/fea0e246-7ebd-4223-8e8e-8f1ab60d4b49/subagents/agent-a95db20ef16f7dcaf.jsonl.

PR intended algo-improvements into main documenting every success and failure; not opened. Do not resume until user asks.

## Resumed 2026-08-27: heldout verified
Saved heldout seeds9–16 (96 rooms/seats) score2038.2, paired +33.21 ±6.51 SE over BUP0. All eight seed averages improve (+7.12 to +64.85). Allplay65.5%, weekly highs17.7%, playoffs77.1%, champions56.3%. This is one 2025 season, not season-independent validation. Next fixed-parameter seed17 sensitivity, seats1/6/12, classic/three_wr/std/ppr/mixed; no additional tuning.

### Completed fixed seed17 sensitivity
Seats1/6/12 per configuration; candidate points and BUP0 deltas: classic: 1875, delta +9.0; three_wr: 1998, delta +45.0; std: 1802.9, delta +0.0; ppr: 2325.1, delta -11.3; mixed: 2025.9, delta +15.9. Runtime 16.4s. Mixed championship/score metrics do not universally improve; these three-seat checks have low power. Strong discovery/heldout mean gains and generally non-catastrophic sensitivity justify a clean fixed heuristic candidate, not a calibrated variance model. Production cleanup and regression tests next.

Production candidate removes mutable risk/ceiling/flat-CV knobs and sigma cache, keeps fixed .5 spread weight with honest heuristic comments. Existing npm test passed28/28 (16.5s under concurrent work). Parent requested additional fixed PPR seeds9–10 all12 seats versus BUP0 before final decision; currently running, no tuning.

PPR expanded completed through seed 9: candidate 2273.2, control 2252.1, n=12; paired artifact ceiling-ppr-expanded.json.

PPR expanded completed through seed 10: candidate 2237.2, control 2226.7, n=24; paired artifact ceiling-ppr-expanded.json.

Expanded PPR complete n24 seeds9–10: 2237.2 vs2226.7, paired +10.53 ±8.97SE. Seed9 +21.06, seed10 unchanged. No clear PPR regression; no tuning or format guards. Added unit test initially failed because synthetic WR slots invoke the existing minimum-depth demand; corrected test to FLEX-only to isolate covered slots. Original production tests remain28/28; rerunning expanded tests.

### Final production candidate verification
30/30 npm tests passed (18.1s concurrent environment). Clean fixed-weight/no-sigma-cache default seed9 seats1/6/12 exactly match saved old-knob heldout outcomes:1999.77,2127.16,2095.44. Fresh same-process draft timing across those three seats: candidate3.551s vs BUP0 control3.033s (~17% slower); this tiny measurement is not a formal benchmark. No Node/process/window dependencies or actual-outcome access added to strategy. Bench removal aligned with root separately; implementation commit excludes it. docs/value-formula.md and docs/ceiling-experiment.md document scoring semantics, parameters, failures, uncertainties and validation. Recommendation: accept fixed heuristic; no calibrated championship claim.

Final implementation commit:66a0b77 (cherry-pick only this; eec217d and76aed3c are already-accepted bench prerequisite alignment). Final full npm test30/30 (16.3s); targeted4/4 after using in-range upside2. Production comments/docs explicitly retain mean-based allocation, not joint objective optimization. Raw data saved in ceiling-sensitivity.json,ceiling-ppr-expanded.json,ceiling-runtime.json with corresponding scripts/logs. Legacy ceiling-resume.mjs imports experimental configureRisk and is archival; use saved value-at-pause.js in an isolated copy to replay old knobs. New sensitivity/runtime/PPR runners target cleaned source. No push/PR performed here; root handles integration and combined rollout check.
