# fantasy-drafter

A small draft-day helper: a script to crunch player data plus a single HTML page
to track picks live during the draft.

## Status

- `client/sleeper.py` — read-only Sleeper API client (players, drafts, leagues)
- `db.py` + `scripts/` — SQLite cache and the loaders that fill it
- `board.json` — the hand-written board: turns, favorites, watched players
- `draft-board.html` — draft board, rendered from the database in the browser
- Ranking/recommendation logic: not written yet

## Layout

- `client/sleeper.py` — Sleeper API wrapper, plus snake-draft helpers
- `db.py` — SQLite schema and upsert helpers
- `bin/start` — build the cache if needed, then serve the board
- `scripts/` — loaders that populate the cache, one concern each
- `board.json` — the turns and the players tagged at each, per league
- `draft-board.html` — the draft board / best-available UI
- `data/` — the SQLite database and cached player file (gitignored)

## Usage

```bash
pip install -r requirements.txt
```

Build the cache:

```bash
python3 -m scripts.load_all
```

That creates `data/fantasy.db` and fills it with the leagues, drafts, rosters,
and players for every username in the `users` table. Re-run it any time to
refresh — every loader is an upsert keyed on Sleeper's ids, so running it twice
leaves the database byte-identical.

The loaders can also be run individually, in this order:

| Script | What it loads |
|---|---|
| `scripts.init_db` | creates the tables, seeds the usernames to track |
| `scripts.load_users` | resolves each username to a Sleeper `user_id` |
| `scripts.load_leagues` | leagues, rosters, and league membership |
| `scripts.load_drafts` | draft settings and every pick made so far |
| `scripts.load_players` | the NFL player file, filtered to draftable players |
| `scripts.load_board` | `board.json` — the turns and the watch/favorite tags |

To track someone else: `python3 -m scripts.init_db <username>`, then re-run
`load_all`. To rebuild from nothing, delete `data/fantasy.db` and run it again.

Then open the board:

```bash
bin/start
```

`bin/start` builds the cache first if there isn't one, then serves the board and
opens it. It runs from any directory, uses `.venv` if you have one, and passes
its arguments through to `scripts.serve` (`--port`, `--no-open`).

## The board

`draft-board.html` has no data in it. It opens `data/fantasy.db` in the browser
with [sql.js](https://sql.js.org) and reads the board out of it — the turns and
tagged players from `board_turns` / `player_tags`, names and teams from
`players`, the roster slots from the league's own `roster_positions`. Editing
`board.json` and re-running `load_board` changes the board; the HTML never
needs touching.

The one cost of reading the database directly is that the page can't be opened
from disk any more — browsers won't let a `file://` page fetch a local file.
`scripts.serve` is a stdlib static server bound to localhost that exists for
that reason, and `bin/start` is the way in.

Two pickers at the top choose what's on show:

- **League** — every league in the cache, boards first. A league with no turns
  in `board_turns` is still listed, marked `no board`, and says so when picked.
  The roster strip, the scoring in the masthead, and the slot the board is
  written from (`1.01`) all come from the league that's selected.
- **Draft** — that league's own draft plus any mock seeded from it. Picking one
  pre-strikes everybody already drafted in it, and the picks made under a
  tracked `user_id` land in the roster strip as yours. Autopicks come through
  with no `picked_by`, so they count as gone rather than as yours.

Switching drafts resets the board to what that draft says, so your own taps
don't carry across from one to another.

Both pickers write to the address bar (`?league=<id>&draft=<id>`), so a board
worth coming back to can be bookmarked.

### Watchlists

Two tags per league, both in `player_tags`:

- **favorite** — a player to take at this turn. Carries the reasoning (`note`),
  and shows up on the board as a yellow card under "take this".
- **watch** — everyone else worth knowing about in that pick range, listed
  under "if they're gone".

A player holds at most one tag per league, so favoriting a watched player
promotes the row rather than adding a second one. `load_board` clears the
league's tags before it writes, which makes `board.json` the whole truth: drop
a player from the file and he leaves the table.

Names in `board.json` are resolved against the `players` table on name plus
position — Sleeper stores "Brian Robinson", never "Brian Robinson Jr.", so both
sides are normalized first. Team defenses match on the team abbreviation. A
name that matches nothing, or matches two players, is reported and skipped
rather than guessed at.

```sql
-- everyone favorited, in board order
SELECT t.picks, t.plan, p.full_name, p.position, p.team, g.adp, g.note
FROM player_tags g
JOIN players p USING (player_id)
JOIN board_turns t ON t.league_id = g.league_id AND t.turn_no = g.turn_no
WHERE g.league_id = ? AND g.kind = 'favorite'
ORDER BY g.turn_no, g.sort_order;
```

### Mock drafts

Mock drafts **cannot be enumerated through the API**. A live mock appears in
neither `/user/{id}/drafts` nor the source league's `/drafts`, and no
undocumented variant returns it. Register one by the id in its URL
(`https://sleeper.com/draft/nfl/<draft_id>`):

```bash
python3 -m scripts.load_drafts --draft-id <draft_id>
```

After that it's a row like any other and plain `load_drafts` keeps it fresh.
Mocks store `league_id` null and `is_mock = 1`; `--leagues-only` skips them.

A registered mock is the one row the loaders can't rediscover, so a schema bump
— which rebuilds the cache from scratch — drops it. Re-register it by id.

A mock started from a league (`mock_type = 'league_mock'`) still records which
league it copied, so it can be joined to that league's scoring and roster rules:

```sql
SELECT d.draft_id, l.name, l.scoring_type, l.roster_positions
FROM drafts d
JOIN leagues l ON l.league_id = COALESCE(d.league_id, d.source_league_id);
```

Since a mock hits exactly the same endpoints as a real draft, it's the right
thing to point the live draft loop at for testing.

Smoke-test the API client directly, without touching the database:

```bash
python3 -m client.sleeper <your-sleeper-username>
```

In code:

```python
from client.sleeper import SleeperClient, fantasy_relevant, on_the_clock

sleeper = SleeperClient()
user = sleeper.get_user("your-username")
leagues = sleeper.get_user_leagues(user["user_id"], 2026)
draft_id = leagues[0]["draft_id"]

draft = sleeper.get_draft(draft_id)
picks = sleeper.get_draft_picks(draft_id)
players = fantasy_relevant(sleeper.get_all_players())  # cached to data/ for 24h

rnd, slot = on_the_clock(len(picks) + 1, draft["settings"]["teams"], draft["type"])
```

Sleeper's API needs no auth and is read-only — you still click the pick
yourself. `SleeperClient` holds a `requests.Session`, so use it as a context
manager (or call `.close()`) if you're polling a live draft.

Reference: https://docs.sleeper.com/
