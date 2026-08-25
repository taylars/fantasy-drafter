-- Real ADP and season projections, replacing the hand-kept adp on player_tags.
--
-- Source is Sleeper's undocumented projections endpoint, which serves both the
-- ADP set and a Rotowire season stat line in one response. See
-- client.SleeperClient.get_projections for the URL shape and the caveat.

CREATE TABLE IF NOT EXISTS player_projections (
    player_id    TEXT NOT NULL REFERENCES players(player_id) ON DELETE CASCADE,
    season       TEXT NOT NULL,

    -- ADP, one column per format Sleeper publishes it in. A league reads the
    -- one matching its scoring_type; db.adp_column picks it.
    adp_std      REAL,
    adp_half_ppr REAL,
    adp_ppr      REAL,
    adp_2qb      REAL,
    adp_rookie   REAL,
    adp_dynasty  REAL,

    -- The projected season stat line, as json: ~50 sparse keys whose names
    -- match the keys in leagues.scoring_settings. Kept whole rather than
    -- flattened into columns because the set varies by position and the
    -- provider is free to add to it. db.score_stats turns it into points.
    stats        TEXT,
    gp           REAL,                 -- projected games played

    -- Sleeper's own preset totals. Stored for reference only: they bake in
    -- generic scoring (pass_int -1, where a league may say -2), so they are a
    -- sanity check, never the number to rank on.
    pts_std      REAL,
    pts_half_ppr REAL,
    pts_ppr      REAL,

    company      TEXT,                 -- projection provider, e.g. rotowire
    updated_at   TEXT,                 -- provider's own timestamp
    fetched_at   TEXT,
    PRIMARY KEY (player_id, season)
);

CREATE INDEX IF NOT EXISTS idx_proj_adp_half ON player_projections(season, adp_half_ppr);
CREATE INDEX IF NOT EXISTS idx_proj_adp_ppr  ON player_projections(season, adp_ppr);

-- player_tags.adp was a manual snapshot typed into board.json. Now that ADP
-- arrives with the projections, the column would be a second, staler answer to
-- the same question.
ALTER TABLE player_tags DROP COLUMN adp;
