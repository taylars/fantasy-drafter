# room-sim — complete — rejected 2026-08-27

Branch `algo/room-sim`. User requested stop to conserve credits. Agents interrupted; final process check found no matching experiment subprocesses.

## State

Resumed by user. Saved BUP0 output verified complete (96 unique matched seed/seat rows): +4.760 points versus BUP0 control, pooled paired SE 2.001, seat-mean SE 3.232. Only 12/96 scores change beyond rounding (10 wins, 2 losses); gains concentrate in seats 1/6/12. Recommendation: reject this bounded experiment as insufficiently robust to offset complexity/model limitations. Final `npm test` rerun passed 28/28 (14.836s); log saved in handoff-artifacts/fantasy-room-validation/tests-resumed.log. No source edits made during resumed analysis; original dirty js/value.js and tmp-probe/ preserved. No implementation commit or merge recommended. Original64 simulation +6.5 concentrated few seats; no-needs -12.4;256 simulation +2.1. 28 tests pass. Marginal probabilities still multiplied independently, ownership inferred from pick order, hero picks skipped. Current source may temporarily set BUP0. No merge.

## Resume

Read handoff-artifacts/experiment-report.md if present, then original-session-audit.md. Source snapshot and dirty patch preserved; this handoff does not approve experimental code. Reports may still say running: output-file existence is not verification. Saved scripts can contain old /private/tmp paths; update paths before rerunning. Preserve evaluator, policy and data. Only2025 outcomes exist; held-out rooms are not held-out seasons.

Shared controls: bench-option worktree handoff-artifacts/fantasy-bench-validation/{baseline,bup0,bss05}/results.json. Original Claude log: ~/.claude/projects/-Users-taylor-larsen-Code-fantasy-drafter/fea0e246-7ebd-4223-8e8e-8f1ab60d4b49/subagents/agent-ac4384ffa2c585741.jsonl.

PR intended algo-improvements into main documenting every success and failure; not opened. User authorized resumption; bounded final analysis complete.
