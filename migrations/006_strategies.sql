-- Strategy moves off the hand-written turns and onto the round.
--
-- board_turns held four things at once: which picks were ours, what round they
-- fell in, and the plan and reasoning for them. The first two are derivable —
-- a draft's own draft_order, teams and type say exactly which picks we own —
-- so keeping them by hand was keeping a second, staler answer. What isn't
-- derivable is the plan, and that belongs to the round rather than the turn.
--
-- Unlike everything else here, `strategies` is not a cache: no loader can
-- reproduce it. Write rows in by hand and they survive a rebuild of the rest.

CREATE TABLE IF NOT EXISTS strategies (
    league_id TEXT NOT NULL REFERENCES leagues(league_id) ON DELETE CASCADE,
    round     INTEGER NOT NULL,
    plan      TEXT,                   -- the headline for the round
    note      TEXT,                   -- the reasoning behind it
    PRIMARY KEY (league_id, round)
);

-- Carry the existing turns forward before dropping them. A turn covering two
-- rounds ("Round 4 / 5 turn") becomes a row for each, since a plan written for
-- a turn is the plan for both of its rounds. Matching on space-delimited
-- tokens keeps '% 1 %' from claiming round 12.
WITH RECURSIVE nums(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM nums WHERE n < 30)
INSERT OR IGNORE INTO strategies (league_id, round, plan, note)
SELECT t.league_id, n.n, t.plan, t.note
  FROM board_turns t
  JOIN nums n ON ' ' || replace(t.round, '/', ' ') || ' ' LIKE '% ' || n.n || ' %';

-- player_tags keeps only what still means something without a turn to hang
-- off: which league, which player, and whether he's a favorite or a watch.
-- The note, tie and flag were all strategy, and strategy now lives per round;
-- turn_no and sort_order described a board that no longer exists.
CREATE TABLE player_tags_new (
    league_id TEXT NOT NULL REFERENCES leagues(league_id) ON DELETE CASCADE,
    player_id TEXT NOT NULL REFERENCES players(player_id) ON DELETE CASCADE,
    kind      TEXT NOT NULL CHECK (kind IN ('favorite', 'watch')),
    tagged_at TEXT,
    PRIMARY KEY (league_id, player_id)
);

INSERT INTO player_tags_new (league_id, player_id, kind, tagged_at)
SELECT league_id, player_id, kind, tagged_at FROM player_tags;

DROP TABLE player_tags;
ALTER TABLE player_tags_new RENAME TO player_tags;
CREATE INDEX IF NOT EXISTS idx_tags_kind ON player_tags(league_id, kind);

DROP TABLE board_turns;
