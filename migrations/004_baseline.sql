-- Baseline: the schema as it stood at user_version 4, before migrations.
--
-- Every statement is IF NOT EXISTS, so this is a no-op against a database that
-- is already at v4 and creates everything on a fresh one. Later migrations
-- alter what this file establishes; none of them edit it.

-- The usernames we want to pull data for. Seeded by hand; everything else in
-- the database hangs off this table.
CREATE TABLE IF NOT EXISTS users (
    username     TEXT PRIMARY KEY,
    user_id      TEXT UNIQUE,          -- null until load_users resolves it
    display_name TEXT,
    avatar       TEXT,
    fetched_at   TEXT
);

CREATE TABLE IF NOT EXISTS leagues (
    league_id        TEXT PRIMARY KEY,
    name             TEXT,
    season           TEXT,
    sport            TEXT,
    status           TEXT,
    total_rosters    INTEGER,
    scoring_type     TEXT,             -- ppr / half_ppr / std
    draft_id         TEXT,
    previous_league_id TEXT,
    roster_positions TEXT,             -- json array
    scoring_settings TEXT,             -- json object
    settings         TEXT,             -- json object
    fetched_at       TEXT
);

-- Which of our users is in which league. A league can outlive a user's
-- interest in it, so this is a link table rather than a column on leagues.
CREATE TABLE IF NOT EXISTS user_leagues (
    username  TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE,
    league_id TEXT NOT NULL REFERENCES leagues(league_id) ON DELETE CASCADE,
    PRIMARY KEY (username, league_id)
);

CREATE TABLE IF NOT EXISTS rosters (
    league_id  TEXT NOT NULL REFERENCES leagues(league_id) ON DELETE CASCADE,
    roster_id  INTEGER NOT NULL,
    owner_id   TEXT,
    players    TEXT,                   -- json array of player_id
    starters   TEXT,                   -- json array of player_id
    settings   TEXT,                   -- json object (wins, losses, fpts...)
    fetched_at TEXT,
    PRIMARY KEY (league_id, roster_id)
);

CREATE TABLE IF NOT EXISTS drafts (
    draft_id          TEXT PRIMARY KEY,
    -- Null for mock drafts. Deliberately not a foreign key: a draft can
    -- reference a league we don't track.
    league_id         TEXT,
    is_mock           INTEGER,
    -- A "league_mock" is seeded from a real league's settings and records it
    -- under metadata.league_id, even though league_id above is null and the
    -- league's own /drafts endpoint won't return it.
    mock_type         TEXT,
    source_league_id  TEXT,
    creators          TEXT,             -- json array of user_id
    season            TEXT,
    sport             TEXT,
    type              TEXT,            -- snake / linear / auction
    status            TEXT,            -- pre_draft / drafting / paused / complete
    start_time        INTEGER,         -- epoch ms
    last_picked       INTEGER,         -- epoch ms
    teams             INTEGER,
    rounds            INTEGER,
    pick_timer        INTEGER,
    reversal_round    INTEGER,
    scoring_type      TEXT,
    draft_order       TEXT,            -- json {user_id: slot}, null pre-order
    slot_to_roster_id TEXT,            -- json {slot: roster_id}, null pre-order
    settings          TEXT,            -- json object
    fetched_at        TEXT
);

CREATE TABLE IF NOT EXISTS draft_picks (
    draft_id    TEXT NOT NULL REFERENCES drafts(draft_id) ON DELETE CASCADE,
    pick_no     INTEGER NOT NULL,
    round       INTEGER,
    draft_slot  INTEGER,
    roster_id   INTEGER,
    player_id   TEXT,
    picked_by   TEXT,                  -- "" on autopicks; fall back to roster_id
    is_keeper   INTEGER,
    metadata    TEXT,                  -- json: name, position, team, amount...
    fetched_at  TEXT,
    PRIMARY KEY (draft_id, pick_no)
);

CREATE INDEX IF NOT EXISTS idx_picks_player ON draft_picks(draft_id, player_id);
CREATE INDEX IF NOT EXISTS idx_drafts_league ON drafts(league_id);

CREATE TABLE IF NOT EXISTS players (
    player_id         TEXT PRIMARY KEY,
    full_name         TEXT,
    first_name        TEXT,
    last_name         TEXT,
    position          TEXT,
    fantasy_positions TEXT,            -- json array; a player can be RB/WR
    team              TEXT,
    status            TEXT,
    injury_status     TEXT,
    age               INTEGER,
    years_exp         INTEGER,
    number            INTEGER,
    search_rank       INTEGER,         -- crude ADP proxy, low = more relevant
    depth_chart_order INTEGER,
    fetched_at        TEXT
);

CREATE INDEX IF NOT EXISTS idx_players_pos ON players(position, search_rank);
CREATE INDEX IF NOT EXISTS idx_players_name ON players(full_name);

-- The turns of one league's draft board: the picks we own, and the plan for
-- each. Ordering is turn_no, not pick number, so a turn can hold two picks
-- ("24 · 25") the way a snake draft's wrap-around actually plays.
CREATE TABLE IF NOT EXISTS board_turns (
    league_id TEXT NOT NULL REFERENCES leagues(league_id) ON DELETE CASCADE,
    turn_no   INTEGER NOT NULL,        -- 1-based, in board order
    picks     TEXT,                    -- pick numbers as shown, e.g. "24 · 25"
    round     TEXT,
    plan      TEXT,                    -- the headline for the turn
    note      TEXT,                    -- the reasoning behind it
    PRIMARY KEY (league_id, turn_no)
);

-- Players we're tracking, per league. `favorite` is one we want to take at a
-- given turn; `watch` is everyone else worth knowing about in that range.
-- A player holds at most one tag per league, so favoriting a watched player
-- promotes the existing row rather than adding a second one.
--
-- Unlike the rest of this database these rows are ours, not Sleeper's, but
-- they're still a cache: scripts/load_board.py rebuilds them from board.json.
CREATE TABLE IF NOT EXISTS player_tags (
    league_id  TEXT NOT NULL REFERENCES leagues(league_id) ON DELETE CASCADE,
    player_id  TEXT NOT NULL REFERENCES players(player_id) ON DELETE CASCADE,
    kind       TEXT NOT NULL CHECK (kind IN ('favorite', 'watch')),
    turn_no    INTEGER,                -- the turn to consider him at
    sort_order INTEGER,                -- position within that turn
    -- The board's own ADP snapshot. Sleeper publishes no ADP, so it comes in
    -- with the board rather than from the players table.
    adp        REAL,
    note       TEXT,                   -- why he's tagged; favorites carry one
    tie        TEXT,                   -- "take whichever is there" and friends
    flag       TEXT,                   -- short warning: "adp rising", "your pick"
    tagged_at  TEXT,
    PRIMARY KEY (league_id, player_id),
    FOREIGN KEY (league_id, turn_no) REFERENCES board_turns(league_id, turn_no) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tags_turn ON player_tags(league_id, turn_no, sort_order);
CREATE INDEX IF NOT EXISTS idx_tags_kind ON player_tags(league_id, kind);
