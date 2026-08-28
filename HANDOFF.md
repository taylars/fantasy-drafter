# correlation — completed 2026-08-27

Branch `algo/correlation`. Resumed at user request; saved holdout analyzed. No new simulations needed.

## State

Completed, reject for production: corrected full+BUP0 gains +7.6 discovery and +11.5 held-out room points, both below the original >20-point gate. Original buggy full gains +4.4 discovery. Duplicate dedicated/FLEX player coverage caused false collision penalty. Corrected variant re-tested: 28/28 pass. All three saved outputs verified: exactly 96 unique expected seed/seat rows each, aggregate mean agrees with reported grade. No merge.

## Resume

Read handoff-artifacts/experiment-report.md if present, then original-session-audit.md. Source snapshot and dirty patch preserved; this handoff does not approve experimental code. Reports may still say running: output-file existence is not verification. Saved scripts can contain old /private/tmp paths; update paths before rerunning. Preserve evaluator, policy and data. Only2025 outcomes exist; held-out rooms are not held-out seasons.

Shared controls: bench-option worktree handoff-artifacts/fantasy-bench-validation/{baseline,bup0,bss05}/results.json. Original Claude log: ~/.claude/projects/-Users-taylor-larsen-Code-fantasy-drafter/fea0e246-7ebd-4223-8e8e-8f1ab60d4b49/subagents/agent-aa78ed01a26c1c937.jsonl.

PR intended algo-improvements into main documenting every success and failure; not opened. No experiment work remains. Experimental source stays uncommitted and must not be merged.
