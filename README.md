# fantasy-drafter

A small draft-day helper: a script to crunch player data plus a single HTML page
to track picks live during the draft.

## Status

- `client/sleeper.py` — read-only Sleeper API client (players, drafts, leagues)
- `db.py` + `scripts/` — SQLite cache and the loaders that fill it
- `draft-board.html` — static draft board, opened straight from disk
- Ranking/recommendation logic: not written yet

## Layout

- `client/sleeper.py` — Sleeper API wrapper, plus snake-draft helpers
- `db.py` — SQLite schema and upsert helpers
- `scripts/` — loaders that populate the cache, one concern each
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

To track someone else: `python3 -m scripts.init_db <username>`, then re-run
`load_all`. To rebuild from nothing, delete `data/fantasy.db` and run it again.

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
