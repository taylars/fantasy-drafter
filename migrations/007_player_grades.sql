-- The context the projections don't carry: how good the offense is, who he
-- depends on, how many games he'll actually play, and how much room sits above
-- the mean case. No Sleeper endpoint answers any of it, so these are researched
-- rather than fetched. See docs/value-formula.md for what consumes them.
--
-- This is a third kind of table. The loaders are caches — run one twice and
-- nothing changes. `strategies` is hand-written and irreplaceable. Grades are
-- reproducible but not deterministic: re-running the research gives a different
-- answer, sometimes a better one. Hence `sources` and `graded_at`, which are
-- what make a grade auditable and let a stale one be spotted — a depth chart in
-- August is not the one from June.
--
-- Grades are ordinal on purpose. Research can defend "this offense is top-ten";
-- it cannot defend "this offense is worth 1.06x". Turning a grade into a
-- multiplier is the formula's job.

CREATE TABLE IF NOT EXISTS player_grades (
    player_id  TEXT NOT NULL REFERENCES players(player_id) ON DELETE CASCADE,
    season     TEXT NOT NULL,

    -- -2..+2, 0 = league average.
    offense    INTEGER CHECK (offense    BETWEEN -2 AND 2),
    support    INTEGER CHECK (support    BETWEEN -2 AND 2),

    -- Expected games played of a 17-game season. Replaces player_projections.gp,
    -- which is 18.0 for every player who has one and so carries no signal at
    -- all. The formula scales points by exp_games / 17, which makes this the
    -- highest-leverage of the four.
    exp_games  REAL    CHECK (exp_games  BETWEEN 0 AND 17),

    -- 0..+3, room above the projection: young and improving, a path to a
    -- starter's workload, or a touchdown role a yardage line understates.
    upside     INTEGER CHECK (upside     BETWEEN 0 AND 3),

    note       TEXT,               -- one line of why, in plain english
    sources    TEXT,               -- json array of urls it was read from
    graded_at  TEXT,
    PRIMARY KEY (player_id, season)
);

CREATE INDEX IF NOT EXISTS idx_grades_season ON player_grades(season);
