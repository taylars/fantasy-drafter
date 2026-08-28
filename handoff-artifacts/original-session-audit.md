# Fantasy drafter Claude session handoff

Source audited read only: main session `fea0e246-7ebd-4223-8e8e-8f1ab60d4b49.jsonl` and all 8 sibling subagent JSONL logs. No experiments or workspace edits were performed.

## User objective and exact operating requirements

The first request was: run the backtest matrix and diagnose why the logic performs poorly; do not make changes. The user then expanded the request: run the normal backtest first; after gathering 3–4 theories, spawn agents to test them in isolated branches/worktrees; retain successful changes on an `algo-improvements` base branch; repeat cycles until several cycles produce no improvement or no more improvements are possible; then open a PR from `algo-improvements` into `main`, with a PR description documenting every attempt, including failures and measured results. The user explicitly encouraged creative improvements toward the best auto-drafter. Final steering was “wrap this up soon, we’re running low on credits.”

Hard measurement rules given to agents: only `js/value.js` may be changed in experiments; do not modify the measuring stick (`js/backtest.js`, `js/draft-policy.js`, `bin/backtest.mjs`, `data/`); no post-draft/actual/weekly data may enter strategy logic; `npm test` must pass (28 tests); report pooled ± and per-seed numbers; only one season exists, so overfitting is a live risk. For second-batch experiments, opponent models could use only published ADP, roster slots, and prior picks and could not import/reimplement the scripted opponent policy. Runtime matters for browser worker use.

## Main diagnosis and base branch

Initial normal run used a single seed and appeared poor/noisy. Production actually uses `PLAN_AHEAD=4` and a board limit of 250, while the backtest default used `ahead=2` and the whole pool. Sweeping old settings gave points 1781.8/1810.4/1845.6/1869.3/1878.2 for ahead 1–5; thus the original apparent regression was a harness mismatch. Main session created `algo-improvements` from the prior clean base and committed:

* `f8dc709 Measure the board the backtest actually ships`: shared `PLAN_AHEAD`/new `BOARD_LIMIT`, production-aligned backtest defaults.
* `8f691ba Pool several rooms so a change can be read against the noise`: `--seeds=...`, pooled runs and points standard error.

Eight-room production-aligned baseline (96 seat/seed runs): BOARD score 76.1, **1896.4 ±9.5 points**, finish 5.05, all-play 55.1%, weekly highs 10%, playoffs 50%, championships 25%; ADP score 71.4, **1846.1 ±14**, finish 6.50. Board positional points QB 252.9, RB 708.6, WR 404.7, TE 249.2, K 176.6, DEF 104.4. Shape diagnosis: board/team QB 1.00, RB 4.27, WR 4.72, TE 3.01, K/DEF 1.00; replacement QB starts 5.5/team versus ADP 2.2; board median K round 10 vs ADP 12; board is RB-heavy and WR-light (RB 708.6 vs 594.9, WR 404.7 vs 577.4).

## Agent handoffs

### `agent-a5d21c2822ff46535` — `algo/bench-option`, worktree `.claude/worktrees/agent-a5d21c2822ff46535`

Hypothesis: flat late bench upside bonus (`BENCH_UPSIDE_POINTS=10`) causes degenerate late picks and TE hoarding. Swept BUP, depth decay, surplus share, and combinations. Baseline reproduced exactly. Strongest result: `BUP=0` gives **2004.6 ±7.4**, score 85.5, finish 2.64, all-play 62.3%, playoffs 76%, champs 44.8%; every seed improved (per-seed 1988.1, 2018.1, 1969.8, 2007.6, 2027.3, 1993.5, 1998.7, 2033.9). It changed roster shape toward QB 2.00, RB 3.76, WR 5.07, TE 2.17 and bench contribution 507.2/44.1 starts. BUP=5 was effectively no gain (1897.1 ±9.6); BDD=.5 also near no-op (1897.5 ±9.4). “No option at all” scored 1977.2 ±8.0. Surplus-share variants improved further: BUP0+BSS.02 **2012.3 ±7.4**; BUP0+BSS.05 **2017.7 ±7.9**; BUP0+BOW.05 **2005.1 ±7.5**. Held-out seeds 9–16 replicated: baseline 1893.6 ±7.9; BUP0 2005.0 ±7.7; BUP0+BSS.05 2024.3 ±7.1; BUP0+BSS.02 2015.8 ±7.5. Continuation review confirmed the official BUP0 gate and 28 tests completed; the agent chose simple BUP0 over tuned BSS variants, then monthly spend-limit failure stopped it before committing; no final result/commit notification was recorded. Treat the promising BUP0/BSS candidates as uncommitted and re-run/inspect before merge; beware these large gains also induce QB2 and could be interacting with other model defects.

### `agent-acb061e0212be2a2b` — `algo/streamable`, worktree `.claude/worktrees/agent-acb061e0212be2a2b`

Hypothesis: K/DEF replacement baseline at 12th-best makes kickers/defenses too early. Swept baseline rung. Verdict is a clean negative; only comments were committed, commit `c13502d` (the main notification called it a comment-only streamable commit; transcript earlier also shows a commit-message correction). Baseline unchanged 1896.4 ±9.5, tests 28/28. Rung results (paired deltas): 40% −1.4 ±1.2; 70% −32.0 ±3.5; 85% −46.8 ±3.8 (every seed: −36.3, −46.1, −46.7, −50.1, −40.8, −59.3, −46.5, −48.7); 100% −20.2 ±3.9; K-only 100% −60.1 ±4.2. Delaying K/DEF frees little useful value and at extremes shifts into QB backups; DEF has a real 12-team cliff. Keep current behavior; preserve comments if desired, no strategy merge. Caveat: K/DEF projection Spearman was only 0.29 (n=17/26), so K edge may be one-season luck.

### `agent-a2d4ac53697508a42` — `algo/rollout`, worktree `.claude/worktrees/agent-a2d4ac53697508a42`

Hypothesis: shallow four-pick one-sample planning is insufficient; test deeper search/full-draft rollout. Baseline ahead=4 1896.4 ±9.5 (~227s in its harness). Greedy rollout at full depth scored 1882.4 ±9.7 (worse); a uniform-position full-depth rollout scored 1909.7 ±7.5, but no completed final commit and API spend-limit failure stopped the task. Depth sweep: ahead=1 1802.9 ±8.7 [14s], 2 1857.9 ±9.1 [22s], 3 1873.3 ±8.5 [69s], 4 1896.4 ±9.5 [227s], 5 1912.5 ±10.4 [1087s, 4.8× cost], 6 1868.3 ±11.5 [38s in a later experimental variant], 8 1913.3 ±9.2 [23s variant], 11 1899.9 ±8.2 [58s variant], 15 1921.3 ±6.9 [144s variant]. Results are not directly comparable across rollout variants; reliable conclusion is depth helps but runtime rises sharply and rollout is unfinished. Do not merge without a clean production-compatible implementation and timing gate.

### `agent-a740e49193fd91e4e` — `algo/baselines`, worktree `.claude/worktrees/agent-a740e49193fd91e4e`

Hypothesis: asymmetric replacement baseline causes RB-heavy drafting. Tested starter-demand/baseline variants. Starter-demand textbook fix lost badly; QB (not RB/WR) drove any wire gain, and TE showed a large interaction. Continuation review found TE and held-out tests had completed: wire QB+TE scored 1946.6 ±7.5 discovery / 1929.6 ±7.5 heldout; injury-demand queue scored 1946.2 ±7.8 / 1950.1 ±6.3. Including FLEX erased most of the queue gain. No final commit; interaction with bench fix remained untested. See /private/tmp/fantasy-baselines-report.md.

### `agent-abf974b668f41c1af` — `algo/qb-depth`, worktree `.claude/worktrees/agent-abf974b668f41c1af`

Hypothesis: DEPTH QB=1 prevents QB2 and causes 5.5 replacement starts. Continuation review corrected this initial summary: the agent completed six measurements. QB2 scored 1915.3 ±8.0, QB2/TE2 1922.9 ±7.7, TE2 1910.1 ±9.4, QB3 1844.3 ±11.8, and QB1.5/TE1.5 1947.2 ±7.8. The fractional variant gained +50.8 ±4.3 paired. No commit; interaction with removal of the bench upside premium remained untested. See /private/tmp/fantasy-qb_depth-report.md.

### `agent-ac4384ffa2c585741` — `algo/room-sim`, worktree `.claude/worktrees/agent-ac4384ffa2c585741`

Hypothesis: simulate intervening opponents with generic ADP/need model rather than independent ADP draws. Experimental room simulation produced unpaired 1902.9 ±10 vs 1896.4 ±9.5, paired delta +6.5 ±2.6 (n=96), but only 45/96 drafts changed and the effect was concentrated in two seats; per-seat aggregate delta +6.5 ±5.7, t=1.14, so pseudo-replication/noise. Removing needs scored 1884 ±8.5; 256 runs 1898.6 ±9.6. Runtime increased 263.7→294.1s. Agent was in ablations when stopped; no commit/result final. Do not merge absent stronger evidence.

### `agent-aa78ed01a26c1c937` — `algo/correlation`, worktree `.claude/worktrees/agent-aa78ed01a26c1c937`

Hypothesis: QB/WR stacking and same-team collision effects using preseason team field. Implemented correlation/collision experiments; collision-only changed points despite rosters never colliding, indicating confounding/noise. Agent was about to run paired comparison when spend-limit failure stopped it. No final result/commit; do not merge.

### `agent-a95db20ef16f7dcaf` — `algo/ceiling`, worktree `.claude/worktrees/agent-a95db20ef16f7dcaf`

Hypothesis: optimize ceiling/variance rather than expected season total. Negative lambda (rewarding variance/ceiling) helped roughly +50–67 points in preliminary sweeps; floor direction did nothing. Probe found `dSigma` spread among top six about 0.8, comparable to total value spread in rounds 3–4, and proportional to position CV × projection, suggesting positional tilt rather than a validated ceiling objective. Flat-CV ablation was next when spend-limit failure stopped it. No final result/commit; do not merge until clean paired/held-out validation.

## Current continuation guidance

All eight agents were reported “running” immediately before final notifications, but each later stopped with the Claude monthly spend-limit API error except streamable, which completed. No active backtests were observed in the parent’s process check. The root session currently has the `algo-improvements` work plus a dirty `.gitignore` adding `.claude/worktrees`; preserve unrelated user changes. The likely first continuation is inspect/reproduce the bench-option BUP0/BSS results on a clean branch, then test interaction with QB-depth and run `npm test`; keep only changes clearly above the ± noise and document every failed branch. No PR was opened in the audited session.
