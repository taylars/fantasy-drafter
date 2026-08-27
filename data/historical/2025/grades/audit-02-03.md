# Batches 02/03 source-support audit

Cutoff: before August 30, 2025. No 2025 regular-season outcomes were used.

The audit retains 100 rows. A researched row means dated player-specific evidence was used to assess one or more factors, not that every input has a complete medical history. Unsupported claims were removed; a 15-game availability default is explicitly distinguished from researched injury information.

## Supported adjustments

- Injury/suspension availability: Brandon Aiyuk, Chris Godwin, Jauan Jennings, Najee Harris, Rashee Rice, Quinshon Judkins, Jordan Addison, Joe Mixon. Expected games are estimates, not known outcomes or exact recovery dates.
- Dated August 29 CBS article prose supports target/role or breakout adjustments for Tetairoa McMillan, Emeka Egbuka, Ricky Pearsall, Rome Odunze, Travis Hunter, Keon Coleman, Christian Kirk. Unsubstantiated factors in those rows remain defaults.
- The dated August 26 PFF overview explicitly reports alternating Jacksonville preseason starters, supporting committee risk for Travis Etienne and Tank Bigsby, but no separate upside premium.

## Rejected or limited evidence

- Replaced Aiyuk's Reddit citation with ESPN's August 11 report.
- Replaced Jaydon Blue's series landing-page URL with the actual dated article URL.
- Added dated team/league reports for Mixon's reserve/NFI placement, Addison's suspension, Najee's active-roster return, Rice's suspension and Robinson's acquisition.
- CBS's running-back article displays July 9 while discussing possible Judkins suspension despite the July 12 arrest; the body version cannot be established from that timestamp. Removed that citation rather than infer its update date.
- CBS quarterback/tight-end ranking tables show later team widgets. Their widgets were not used to assign historical teams or player factors.
- PFF's accessible text contains overview bullets and embedded team-chart images, not the claimed individual injury histories. Precise unsupported historical injury claims were removed.

## Expanded research

Additional dated NFL positional analysis and official team camp previews, transactions and practice reports establish individual roles and development cases. New reporting covers Diggs' camp clearance, Chubb's prior knee injury, Stevenson's competition, the Washington backfield after Robinson's trade, Green Bay receiver competition, Ferguson's extension, Mooney's shoulder, Shakir's ankle and Shaheed's recovery. Team-chart or ranking membership alone does not establish injury history or upside.

Final validation: all 100 rows are `researched` for at least one specifically supported factor, with no wholly unresearched fallback rows. This does not mean every factor is non-default: 72 players retain 15 expected games, and notes distinguish those assumptions. Upside distribution is 57 zero, 33 +1, 10 +2, and zero +3. The final six checks added dated evidence for Pacheco's recovery, Waddle's return to drills, Charbonnet's preseason usage, Pittman's rebound case, Gordon's role opening and Benson's expanded tandem role.

Both files parse as JSON, contain 50 players each, and all recorded source dates precede August 30, 2025. No Reddit or Wikipedia citations remain. Search queries included `before:2025-08-30`; later results returned despite that filter, live widgets and related-story blocks were excluded from grading evidence. Quantitative grades remain analyst judgments rather than facts quoted from sources. Backtests must not call the dataset hindsight-proof.

This audit does not alter canonical offense normalization. It does not establish that third-party pages are immutable archival snapshots; publication dates alone are not cryptographic proof against silent edits.
