# fantasy-drafter

A small draft-day helper: a script to crunch player data plus a single HTML page
to track picks live during the draft.

## Status

- `client/sleeper.py` — read-only Sleeper API client (players, drafts, leagues)
- `db.py` + `scripts/` — SQLite cache and the loaders that fill it
- `strategies` — the plan for each round, written by hand straight into the table
- `watchlist.json` — players to mark out on the board, per league
- `draft-board.html` — draft board, rendered from the database in the browser
- Ranking/recommendation logic: not written yet

## Layout

- `client/sleeper.py` — Sleeper API wrapper, plus snake-draft helpers
- `db.py` — connection, migrations, scoring, and upsert helpers
- `migrations/` — schema changes as numbered `.sql`, applied in order
- `bin/start` — build the cache if needed, then serve the board
- `scripts/` — loaders that populate the cache, one concern each
- `watchlist.json` — the players to flag, per league
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
| `scripts.load_players` | the NFL player file, filtered to the fantasy positions |
| `scripts.load_projections` | season ADP and projections, per player |
| `scripts.load_watchlist` | `watchlist.json` — the watch/favorite tags |

To track someone else: `python3 -m scripts.init_db <username>`, then re-run
`load_all`. To rebuild from nothing, delete `data/fantasy.db` and run it again.

### Schema changes

Each change is a file in `migrations/`, named `NNN_what_it_does.sql`. `db.init`
compares the leading number against the database's `user_version` and applies
whatever is newer, lowest first, so an existing cache changes shape in place
instead of being dropped and refetched. To add one, write the next number up —
nothing else needs editing.

Then open the board:

```bash
bin/start
```

`bin/start` builds the cache first if there isn't one, then serves the board and
opens it. It runs from any directory, uses `.venv` if you have one, and passes
its arguments through to `scripts.serve` (`--port`, `--no-open`).

## The board

`draft-board.html` has no data in it. It opens `data/fantasy.db` in the browser
with [sql.js](https://sql.js.org) and reads the board out of it — every player
Sleeper publishes an ADP for from `players` / `player_projections`, the plan at
each pick from `strategies`, the flagged players from `player_tags`, the roster
slots from the league's own `roster_positions`. The HTML never needs touching.

The board is one vertical list of every player with an ADP, best first, broken
up wherever one of your own picks falls. Tapping a row opens that player's page
on Sleeper in a new tab; holding a row watches him and tapping his star
favorites him (see [Watchlists](#watchlists)). Tagging is the only thing on the
page that writes — everything else is the cache's answer, not the board's, so
there is no state here to get out of step with the draft. Nothing about the
layout is written down anywhere:

- **The order** is the league's own ADP column — `adp_ppr` for a PPR league,
  `adp_half_ppr` for a half-PPR one, and so on. Sleeper reports "not drafted"
  as an ADP of 999 rather than a null, so that value is filtered out by
  value; everything below it is on the list.
- **The breaks** are derived from the draft, not written down. The draft's
  `draft_order` says which slot is ours, and the slot plus `teams`, `rounds`
  and `type` gives every pick we own. Consecutive pick numbers are one trip to
  the board, so a snake turn merges into a single break (`24 · 25`, rounds
  2 / 3) rather than two. A break sits in front of the first player already
  going later than its first pick, which works because ADP is measured in pick
  numbers. A draft whose order hasn't been set yet gets no breaks.
- **The plan** on each break is the `strategies` row for that round, if there
  is one. When a merged turn's rounds say the same thing it's printed once;
  when they disagree, each plan is printed under the round it belongs to.
  Without any row the break still shows the picks and the rounds.
- **Who's gone** is `draft_picks` for the selected draft, and nothing else. A
  player taken by somebody else is struck through; one taken under a tracked
  `user_id` is marked as yours instead and fills a roster slot. Re-run
  `load_drafts` mid-draft and the board catches up on reload.

The one cost of reading the database directly is that the page can't be opened
from disk any more — browsers won't let a `file://` page fetch a local file.
`scripts.serve` is a stdlib static server bound to localhost that exists for
that reason, and `bin/start` is the way in. It serves one thing that isn't a
file, `POST /api/tags`, which writes a single `player_tags` row:

```
POST /api/tags   {"league_id": "...", "player_id": "4866", "kind": "watch"}
                 {"league_id": "...", "player_id": "4866", "kind": null}   # untag
```

sql.js only reads, so a tag made on the board has to go back to the server to
outlive the tab. It writes the same row `load_watchlist` writes, and nothing
else on the page posts anywhere.

Two pickers at the top choose what's on show:

- **League** — every league in the cache. The roster strip, the ADP column, the
  scoring in the masthead, and the plans on the breaks all come from the league
  that's selected.
- **Draft** — that league's own draft plus any mock seeded from it. This is the
  only thing that decides what's struck out, and the picks made under a tracked
  `user_id` are the only thing that fills the roster strip. Autopicks come
  through with no `picked_by`, so they count as gone rather than as yours. The
  draft is also where the breaks come from, so switching drafts moves them — a
  mock from another seat redraws the whole board around it.

Both pickers write to the address bar (`?league=<id>&draft=<id>`), so a board
worth coming back to can be bookmarked.

### Strategy

`strategies` holds one row per league per round — a `plan` headline and a
`note` behind it — and the board prints it on the break for that round:

```sql
INSERT INTO strategies (league_id, round, plan, note) VALUES
  (?, 5, 'Elite TE or best WR',
      'The drop after the top two tight ends is a cliff. If neither is there, '
      'take the receiver and stream the position.')
ON CONFLICT (league_id, round) DO UPDATE
  SET plan = excluded.plan, note = excluded.note;
```

This is the one table with no loader behind it, and the only thing in the
database that isn't a cache: nothing can refetch an opinion. Migrations don't
drop data, so rows written here survive a rebuild of everything else — but
deleting `data/fantasy.db` takes them with it.

A round with no row is fine. The break still shows the pick number and the
round; it just has nothing to say about them.

### Watchlists

Two tags per league, both in `player_tags`, and both only about emphasis — the
player is on the list either way, at whatever ADP puts him:

- **watch** — the row is highlighted, so it's visible while scrolling past.
- **favorite** — the same highlight, plus a gold star at the end of the row.

Being tagged at all is what the highlight says; the star picks the favorites
back out of it.

A player holds at most one tag per league, so favoriting a watched player
promotes the row rather than adding a second one.

Tags can be made from the file or from the board itself, since the ones worth
making during a draft are the ones you'd never have written down beforehand:

- **Hold a row** — watches an untagged player, and clears whatever tag a
  tagged one has. A press that travels is a scroll, so the list still scrolls
  normally.
- **Tap the star** — favorites him, and un-favoriting drops him back to a
  watch rather than off the list. Between the two gestures every state is
  reachable, and nothing can be tagged into a state the other can't undo.
- **W and F** do the same two things from the keyboard, on whichever row has
  focus, for anyone tabbing through the list.

Either way the row redraws first and the write follows; a write that fails puts
the row back the way it was and says so. `load_watchlist` clears the league's
tags before it writes, which makes `watchlist.json` the whole truth when it
runs — so a tag made on the board is lost the next time the file is loaded
against that league.

Names in `watchlist.json` are resolved against the `players` table on name plus
position — Sleeper stores "Brian Robinson", never "Brian Robinson Jr.", so both
sides are normalized first. Team defenses match on the team abbreviation. A
name that matches nothing, or matches two players, is reported and skipped
rather than guessed at.

```sql
-- everyone favorited, in ADP order
SELECT p.full_name, p.position, p.team, pr.adp_half_ppr
FROM player_tags g
JOIN players p USING (player_id)
LEFT JOIN player_projections pr ON pr.player_id = g.player_id AND pr.season = '2026'
WHERE g.league_id = ? AND g.kind = 'favorite'
ORDER BY pr.adp_half_ppr;
```

### ADP and projections

Both come from `api.sleeper.app/projections/nfl/<season>`, which is not in
Sleeper's public docs and can change without warning — `get_projections` is the
only thing that touches it. One response carries the ADP set for every scoring
format and a Rotowire season stat line, keyed by the same `player_id` as the
player file, so nothing has to be name-matched.

`load_players` filters the player file by position only, deliberately: Sleeper
publishes ADP for players it currently lists as free agents, and
`player_projections` keys off the `players` table — so filtering those out
would silently drop their ADP with them.

`player_projections` stores ADP one column per format and the projected stat
line whole, as json. Points are **not** stored, because the same projection is
worth different amounts in different leagues:

```python
pts = db.projected_points(conn, league_id)   # {player_id: points}
```

That applies the league's own `scoring_settings`, which is the point. Sleeper's
precomputed `pts_half_ppr` uses a generic preset — it docks an interception 1
point where the Atlanta League says 2, enough to misrank every QB by up to 14
points. The stored `pts_*` columns are kept only as a sanity check; rank on
`projected_points`.

`draft-board.html` mirrors this in `scoreStats`, so the board and the database
agree on what a player is worth. Deep bench players come back with ADP but no
stat line, so `projected_points` omits them rather than scoring them zero.

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

A registered mock is the one row the loaders can't rediscover. Migrations no
longer drop the cache, so it now survives a schema change.

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
