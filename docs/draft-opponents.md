# Scripted ADP opponents

The `adp` baseline now means roster-aware scripted ADP, not taking the next
name blindly. Its independent policy lives in `js/draft-policy.js`; it does
not use the board's projections, grades, or any actual weekly results.

- Build required RB/WR starters early; reserve room for FLEX and depth.
- Prefer the first QB/TE around round 7, with stronger need as time passes.
- Penalize redundant QB/TE backups and excessive RB/WR hoarding.
- Usually leave K/DEF until the final rounds; never duplicate them.
- Robust RB favors two early backs, Zero RB discourages backs through round 4,
  and late-QB moves its QB target to round 10.

These are soft preferences measured in ADP pick units, not forced round-by-round
position choices. A sufficiently large bargain can override the plan. Small
seeded player preferences (plus/minus 0.3 rounds) vary close calls. These
parameters are explicit modeling assumptions, not empirically fitted human
behavior or parameters chosen to make our board win.

Only completion is mandatory: every choice must leave enough remaining picks
to fill exact positions and FLEX. The simulator applies the same completion
check to the board. It does not change the live value algorithm.

Use `npm run backtest -- --seed=42` or
`npm run backtest -- --matrix --seed=42` to change the simulated preferences.
The default seed is 1. Identical seeds preserve manager/candidate preferences
across counterfactual board-versus-ADP drafts. The ADP comparison seat always
uses the balanced ADP script, even in mixed-style rooms. Pick logs record the
actual style of each opponent.

The matrix currently evaluates one seed per invocation; repeat it with several
seeds before interpreting a small performance difference. Earlier grades based
on the simplistic ADP policy are not comparable with this version.
