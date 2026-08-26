# fantasy-drafter

A small draft-day helper: a script to crunch player data plus a single HTML page
to track picks live during the draft.

## Status

- `js/` — the Sleeper client and value formula, for the browser and the CLI
- `bin/board.mjs` — the board from a terminal, given only a Sleeper username
- `client/sleeper.py` — read-only Sleeper API client (players, drafts, leagues)
- `db.py` + `scripts/` — SQLite cache and the loaders that fill it
- `player_grades` — researched context the projections don't carry
- `docs/` — what the board should rank on, and the formula that does it
- `index.html` — the board itself: a Sleeper username in, a priced board out
- the live button — polls the draft and re-prices the board while it runs
- `value.py` — what each player is worth to us, given roster and picks left

## Layout

- `js/` — Sleeper client, player pool, and the value formula as ES modules
- `bin/board.mjs` — the value model on the command line
- `data/grades.json` — the researched grades, the one thing the board ships
- `client/sleeper.py` — Sleeper API wrapper, plus snake-draft helpers
- `db.py` — connection, migrations, scoring, and upsert helpers
- `value.py` — the draft value formula: lineup coverage, baselines, VONA
- `migrations/` — schema changes as numbered `.sql`, applied in order
- `bin/start` — build the cache if needed, then serve the board
- `scripts/` — loaders that populate the cache, one concern each
- `index.html` — the draft board, and the only page there is
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
| `scripts.grade_queue` | writes the list of players still needing grades |
| `scripts.load_grades` | researched grades from `data/grades/graded-*.json` |

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

## The model in JavaScript

`js/` is the board's engine, and it runs in a browser and under Node alike. It
exists because the board is moving into the browser entirely — no server, no
SQLite, nothing to run before opening it — and because a grading pass needs to
see what the formula does with a grade it just wrote.

| module | what it is |
|---|---|
| `js/sleeper.js` | the Sleeper API client: users, leagues, drafts, projections |
| `js/pool.js` | Sleeper's shapes turned into priced players |
| `js/value.js` | the value formula, pure arithmetic over a pool |
| `js/cache-fs.js` | the Node-side response cache (the browser has its own) |

`js/value.js` is a port of `value.py` and is checked against it: over a full
250-row board the two agree on every player, every value, and the ranking
order, and the plan tables come out byte-identical. It is about four times
faster, which is what makes it viable to re-price a board on every pick.

```bash
node bin/board.mjs --user <sleeper username>          # the board
node bin/board.mjs --user <name> --plan               # take now, or wait?
node bin/board.mjs --user <name> --json --top 250     # the whole ranked board
node bin/board.mjs --user <name> --league <id> --draft <id>
```

Everything is derived from the username: the leagues, the draft, the picks
already made, and the roster you hold. The only thing not fetched is
`data/grades.json`, the researched context in [Grades](#grades) — it is the one
piece of data the board ships rather than reads from Sleeper.

Projections are cached under `data/cache` for six hours, so a rerun costs no
requests. The full 14 MB player file is never fetched at all: the projections
response already carries each player's name, team, position and injury status
alongside his ADP and stat line.

## The board

`index.html` has no data in it and nothing to set up. It asks for a Sleeper
username, and everything else follows: the leagues that username is in, the
draft, the seat you hold in it, the picks already made, and every player Sleeper
publishes an ADP for. It talks to Sleeper directly from the browser — there is
no server, no database, and nothing to run first.

The one thing it ships rather than fetches is `data/grades.json`, the researched
context in [Grades](#grades). That is the whole reason the value column is worth
more than the ADP beside it.

### Signing in

The start screen is one field. A username that isn't a Sleeper account says so;
one that is in no leagues this season says that instead, rather than failing
somewhere deeper as an empty board. Both are the ordinary way to get this wrong
and neither should look like a bug.

Once in, the address bar carries `?user=&league=&draft=`, so a board worth
coming back to can be bookmarked and it opens straight onto that board. **Not
you?** in the masthead goes back to the field.

Nothing is signed in to and nothing is stored anywhere but your own browser: a
Sleeper username is public, and reading one needs no credential.

### The list

The board is one vertical list of every player with an ADP, best first, broken
up wherever one of your own picks falls. Tapping a row opens that player's page
on Sleeper in a new tab. Nothing about the layout is written down anywhere:

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
- **Who's gone** is `draft_picks` for the selected draft, and nothing else. A
  player taken by somebody else is struck through; one taken under a tracked
  `user_id` is marked as yours instead and fills a roster slot. Re-run
  `load_drafts` mid-draft and the board catches up on reload.

### Pricing

The value column is `js/value.js`, run in a Web Worker. Pricing a board is a few
hundred milliseconds of arithmetic — a plan search four picks deep, branching
over six positions — which is not long, but far too long to spend on the thread
keeping the page scrollable, and it happens again every three seconds while a
draft is live. The worker holds the player pool; each poll sends it only the
picks.

The board prices itself once on load whatever the live button is doing, because
a board with numbers on it is worth more than one without, and that first
pricing costs no requests at all.

Two pickers at the top choose what's on show:

- **League** — every league in the cache. The roster strip, the ADP column, and
  the scoring in the masthead all come from the league that's selected.
- **Draft** — that league's own draft plus any mock seeded from it. This is the
  only thing that decides what's struck out, and the picks made under a tracked
  `user_id` are the only thing that fills the roster strip. Autopicks come
  through with no `picked_by`, so they count as gone rather than as yours. The
  draft is also where the breaks come from, so switching drafts moves them — a
  mock from another seat redraws the whole board around it.

Both pickers write to the address bar (`?league=<id>&draft=<id>`), so a board
worth coming back to can be bookmarked.

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

`js/pool.js` mirrors this in `scoreStats`, so the board and the database
agree on what a player is worth. Deep bench players come back with ADP but no
stat line, so `projected_points` omits them rather than scoring them zero.

### Mock drafts

Mock drafts **cannot be enumerated through the API**. A live mock appears in
neither `/user/{id}/drafts` nor the source league's `/drafts`, and no
undocumented variant returns it. So the board can't list one for you: press
**+** next to the draft picker and paste the url it hands out
(`https://sleeper.com/draft/nfl/<draft_id>`).

That id is the one thing about a mock nothing else can tell us, so the browser
remembers it against the league it was pasted in from and re-fetches it on the
next visit. A mock that has since been deleted is dropped from the picker
rather than breaking it.

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

### Grades

`player_grades` holds the four things a projection can't tell us: how good the
offense is, how good the teammates his production depends on are, how many
games he'll actually play, and how much room sits above the mean case. Nothing
in Sleeper's API answers any of them, so they're researched rather than
fetched — see [docs/value-formula.md](docs/value-formula.md) for what consumes
them and why these four.

```bash
python3 -m scripts.grade_queue          # who needs grading, in batches of 25
```

That writes `data/grades/queue-NN.json` — the top 200 by ADP, skipping kickers
and defenses, whose value is flat across the whole draft. Research fills in a
`graded-NN.json` beside each one (the `grade-players` skill in `.claude/skills`
says how, and is written to be run a batch at a time, in parallel), and:

```bash
python3 -m scripts.load_grades          # every data/grades/graded-*.json
```

Files are validated whole: a batch with a grade out of range, an unknown
player, or no sources is rejected entirely and reported, rather than
half-loaded. `--dry-run` checks a file without writing. Loading is an upsert
over the players a file names and nothing else, so one bad batch can be redone
on its own.

Grades are the one thing here that isn't a plain cache. The loaders are caches
— run one twice and nothing changes. Grades are reproducible but not
deterministic: re-running the research gives a different answer, sometimes a
better one. `sources` and `graded_at` are what make one auditable and let a
stale one be spotted.

## What a player is worth

The board sorts by ADP, which is what the rest of the league thinks. `value.py`
is what we think:

```bash
python3 -m value                  # the live draft, best first
python3 -m value --plan           # take a back now, or wait a round?
```

It prices a player three ways at once — against the lineup we already hold,
against the baseline his position can actually be replaced at, and against what
waiting until our next pick would get us instead:

```
value = gain(player) - wait(position)
```

That last comparison is value-based drafting with a next-available baseline,
which is a decades-old idea. The parts specific to us are that a season is
priced as seventeen weeks of coverage rather than a starting lineup — so the
third running back is the man who plays the games the first two miss — and that
the replacement baseline turns on whether a position can genuinely be streamed.
Only kickers and defenses can: the gap between the last starting kicker and the
best one on the wire is 0 points, where for a running back it is 102.

[docs/value-formula.md](docs/value-formula.md) is the derivation, with the
numbers and what it was checked against. [docs/drafting-goals.md](docs/drafting-goals.md)
is why these are the right questions.

### Going live

The board is a read of the database as it stood when the page loaded, which is
the right thing for planning and the wrong thing during a draft: a pick made
thirty seconds ago changes what everything is worth, and the page can't see it.
The **Live** button in the picker row is the answer. Click it and the light
comes on; click it again and it goes out.

While it's lit, every three seconds the page asks the server for
`GET /api/value`, which pulls the draft's picks from Sleeper, re-runs
`value.py` against them, and hands back both. Players taken since the last
tick get struck through, the roster strip fills in, every value is
recalculated against the roster we now hold, and the best player available is
outlined in green. Rows are patched where they stand rather than rebuilt, so
the scroll position survives — mid-draft that's the thing you're holding onto.

**Sleeper's draft endpoints sit behind Cloudflare with `s-maxage=86400`, and
that is the thing most likely to make the board look stuck.** Poll them plainly
and you can be handed an edge copy that is hours old: verified against a real
draft, the same `x-request-id` came back over and over with
`cf-cache-status: HIT` and `age` climbing past 6800 seconds. Polling faster
changes nothing when the CDN keeps answering with the same body, which is why
the first attempt at fixing this — just shortening the interval — didn't help.
Request `Cache-Control: no-cache` and `Pragma: no-cache` are both ignored;
a unique query parameter is what reaches the origin, and that is what
`SleeperClient`'s `fresh=True` adds. It is the default on `get_draft` and
`get_draft_picks`, because there is no such thing as a usefully stale pick
list. It costs about 100ms a request — an origin round trip instead of an edge
one — which is a trade worth making every time. Sleeper's own app uses
websockets and never notices any of this.

Three seconds is the cadence [client/sleeper.py](client/sleeper.py) documents
for a draft loop: 20 polls a minute, well under Sleeper's limit of 1000. It
started at ten and that was too slow to be live — bots in a mock pick every
couple of seconds, so a tick could open with most of a round already gone, and
the board would show it without ever looking broken. The server keeps up by
sharing one Sleeper session across polls instead of building one per request,
reusing the draft object for 30s while fetching picks every time, and serving
requests on threads so a slow call blocks only its own poll.

Three details worth knowing. Only one poll is ever in the air: a request that
outlasts its interval doesn't get another fired on top of it, and a reply
overtaken by a newer one is dropped rather than allowed to paint the board back
to a pick that has already happened. The light stays on through a failed
request and turns amber instead — a dropped connection during a draft should
not be the thing that stops the board updating — and once what's on screen is
more than fifteen seconds old the label says how old, so a board that has
quietly fallen behind looks different from one that just updated. Polling stops
on its own when the tab is hidden, or when you switch leagues or drafts; prices
belong to one draft's state, so the old numbers go rather than linger.

If the board ever looks behind again, measure it rather than guess:

```
python3 -m scripts.watch_draft <draft_id>
```

[scripts/watch_draft.py](scripts/watch_draft.py) times each pick from Sleeper's
own `last_picked` clock to our first sighting of it, correcting for the skew
between the two machines, and by default polls the plain cached endpoint
alongside the busted one so you can see how far the CDN copy is trailing. It
answers the question the board can't answer about itself: whether a lagging
board is us polling too slowly or Sleeper handing out a stale answer.

Value is computed on the server rather than in the page. The board already
mirrors one thing from the database — `scoreStats`, so the page and `db.py`
agree on what a player is worth — and that single duplication costs something
every time scoring changes. Mirroring the whole value formula would be a
second copy of something far larger, and it would drift from `value.py` the
first time either side was touched.
