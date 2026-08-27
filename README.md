# fantasy-drafter

A draft board that runs entirely in your browser. Type a Sleeper username and
it prices every available player against the roster you hold, the picks you
have left, and what waiting until your next turn would get you instead.

No server, no database, no install. It reads Sleeper directly from the page.

## Try it

Open the published board, or run it locally:

```bash
bin/dev
```

Then <http://localhost:8000>. That is a static file server and nothing else —
what runs locally is exactly what GitHub Pages serves, because there is no
server side to any of it.

A server is needed at all only because ES modules and workers are subject to
the same-origin policy, and a `file://` page has no origin to share. Opening
`index.html` from disk will not work.

## Layout

| | |
|---|---|
| `index.html` | the board, and the only page there is |
| `js/sleeper.js` | read-only Sleeper API client |
| `js/pool.js` | Sleeper's shapes turned into priced players |
| `js/value.js` | the value formula: lineup coverage, baselines, plan search |
| `js/worker.js` | the formula, off the main thread |
| `js/app.js` | the page: start screen, pickers, rendering, live polling |
| `js/cache-idb.js` · `js/cache-fs.js` | the response cache, one per environment |
| `data/grades.json` | the researched grades — the only data shipped |
| `bin/board.mjs` | the board on the command line |
| `bin/grades.mjs` | what needs grading, and building `data/grades.json` |
| `bin/fixture.mjs` | freezing today's pool as the test fixture |
| `bin/test` | the test runner |
| `bin/dev` | the local static server |
| `test/` | what the board should recommend, against a frozen pool |

Everything is plain ES modules with no build step and no dependencies. `js/`
runs unchanged in a browser and under Node, which is what lets the command-line
tools and the page share one implementation of the model rather than two.

## The board

`index.html` has no data in it and nothing to set up. It asks for a Sleeper
username, and everything else follows: the leagues that username is in, the
draft, the seat you hold in it, the picks already made, and every player Sleeper
publishes an ADP for.

### Signing in

The start screen is one field. A username that isn't a Sleeper account says so;
one that is in no leagues this season says that instead, rather than failing
somewhere deeper as an empty board. Both are the ordinary way to get this wrong
and neither should look like a bug.

Nothing is signed in to. A Sleeper username is public and reading one needs no
credential, so there is nothing to store anywhere but your own browser.

### Coming back

A draft runs for hours across a tab that gets backgrounded, a phone that locks,
and a browser that decides to reclaim the memory. Coming back to a username
field mid-draft is the failure this is built to prevent, so the board remembers
where it was:

| what | where | why there |
|---|---|---|
| username, league, draft | `localStorage` | three ids, needed before anything can be fetched |
| favorites | `localStorage`, per league | an opinion, and the only one the board stores |
| ADP and projections | IndexedDB, 6h | 3 MB; moves over days, not over a draft |
| user, leagues, draft lists | IndexedDB, 24h / 10m / 1m | the round trips between opening the board and seeing it |
| which stretches are folded | `localStorage`, per draft | a view preference, not draft state |
| whether the light was on | `localStorage` | you should not have to remember to switch polling back on |
| mock draft ids | `localStorage`, per league | Sleeper cannot list them; this is the only record |

Only ids are kept. **Picks are never cached** — a remembered draft is not a
remembered pick list, and the picks are both the part that must never be stale
and the part that is cheapest to ask for.

The address bar carries `?user=&league=&draft=` as well, so a board is
bookmarkable and shareable. A link wins over a remembered session, because a
link is something you just chose.

**Not you?** in the masthead forgets everything and goes back to the field.
**refresh player data** in the footer drops the cached projections and refetches
them, for the evening Sleeper republishes ADP and the board is still showing
this morning's.

### The list

One vertical list of every player with an ADP, best first, broken wherever one
of your own picks falls. Tapping a row opens that player on Sleeper. Nothing
about the layout is written down anywhere:

- **The order** is the ADP format of the draft on screen — `adp_std` in a
  standard mock, `adp_half_ppr` in a half-PPR league. The draft is asked first
  because a mock started cold belongs to no league and can be scored
  differently from the league you opened it under; the league's own
  `scoring_settings` are the fallback for a board with no draft yet. Sleeper
  reports "not drafted" as an ADP of 999 rather than a null, so that value is
  filtered out by value.
- **The breaks** are derived from the draft. Its `draft_order` says which slot
  is yours, and the slot plus `teams`, `rounds` and `type` gives every pick you
  own. Consecutive pick numbers are one trip to the board, so a snake turn
  merges into a single break (`24 · 25`) rather than two. A break sits in front
  of the first player already going later than its first pick, which works
  because ADP is measured in pick numbers. A draft whose order isn't set yet
  gets no breaks. Press the pick number to fold that stretch away.
- **Who's gone** is the draft's picks and nothing else. A player taken by
  someone else is struck through; one taken by you is marked as yours and fills
  a roster slot. Autopicks come through with no `picked_by`, so they count as
  gone rather than as yours.
- **The value** is the green number, and the three best available are outlined.

### Favorites

Tap a row's star, or press **F** with it focused. The row lifts out of the list
and the star fills.

That is all it does. It changes no number and moves no row — a favorite is on
the list either way, at whatever ADP puts him. Everything else on a row is
computed, and this is the exception: the player you decided you want, for a
reason the formula doesn't have. Making him findable while scrolling past two
hundred rows on the clock is the whole job.

Favorites are per league, and live in your browser. There is nowhere else to
put them, which also means they are yours and go nowhere.

### Pricing

The value column is `js/value.js`, run in a Web Worker. Pricing a board is a
few hundred milliseconds of arithmetic — a plan search four picks deep,
branching over six positions — which is not long, but far too long to spend on
the thread keeping the page scrollable, and it happens again every three
seconds while a draft is live. The worker holds the player pool; each poll
sends it only the picks.

The board prices itself once on load whatever the live button is doing, because
a board with numbers on it is worth more than one without, and that first
pricing costs no requests at all.

### Going live

A board priced when the page loaded is wrong by the time it matters: a pick
made thirty seconds ago changes what everything is worth. The **Live** button
polls the draft every three seconds and re-prices against it. Rows are patched
where they stand rather than rebuilt, so the scroll position survives — mid-draft
that's the thing you're holding onto.

**Sleeper's draft endpoints sit behind Cloudflare with `s-maxage=86400`, and
that is the thing most likely to make the board look stuck.** Poll them plainly
and you can be handed an edge copy that is hours old: verified against a real
draft, the same `x-request-id` came back over and over with
`cf-cache-status: HIT` and `age` climbing past 6800 seconds. Polling faster
changes nothing when the CDN keeps answering with the same body, which is why
the first attempt at fixing this — just shortening the interval — didn't help.
`Cache-Control: no-cache` and `Pragma: no-cache` are both ignored; a unique
query parameter is what reaches the origin, and that is what `fresh` adds. It is
the default on `getDraft` and `getDraftPicks`, because there is no such thing as
a usefully stale pick list. It costs about 100ms a request — an origin round
trip instead of an edge one — which is a trade worth making every time.
Sleeper's own app uses websockets and never notices any of this.

Three seconds is 20 polls a minute, well under Sleeper's limit of 1000. It
started at ten and that was too slow to be live — bots in a mock pick every
couple of seconds, so a tick could open with most of a round already gone, and
the board would show it without ever looking broken.

Three details worth knowing. Only one poll is ever in the air: a request that
outlasts its interval doesn't get another fired on top of it, and a reply
overtaken by a newer one is dropped rather than allowed to paint the board back
to a pick that has already happened. The light stays on through a failed request
and turns amber instead — a dropped connection during a draft should not be the
thing that stops the board updating — and once what's on screen is more than
fifteen seconds old the label says how old, so a board that has quietly fallen
behind looks different from one that just updated. Polling stops on its own when
the tab is hidden, or when you switch leagues or drafts.

### Mock drafts

Mock drafts **cannot be enumerated through the API**. A live mock appears in
neither `/user/{id}/drafts` nor the source league's `/drafts`, and no
undocumented variant returns it. So the board can't list one for you: press
**+** next to the draft picker and paste the url it hands out
(`https://sleeper.com/draft/nfl/<draft_id>`).

That id is the one thing about a mock nothing else can tell us, so the browser
remembers it against the league it was pasted in from and re-fetches it on the
next visit. A mock that has since been deleted is dropped from the picker rather
than breaking it.

## ADP and projections

Everything the board knows about players comes from
`api.sleeper.app/projections/nfl/<season>`, which is **not in Sleeper's public
docs** and can change without warning — `getProjections` is the only thing that
touches it.

One response, about 3 MB, carries all six drafted positions: each player's name,
team, position and injury status, the ADP set for every scoring format, and a
Rotowire projected stat line keyed the same way a league's `scoring_settings`
is. That is the whole player pool.

**The 14 MB `/players/nfl` file is never fetched by the board**, because
everything it would answer is already in the response above. Only
`bin/grades.mjs queue` pulls it, for `age` and `depth_chart_order` — two fields
nothing on the board reads but a researcher wants in front of them.

Points are not stored anywhere, because the same projection is worth different
amounts in different leagues. `scoreStats` applies the league's own
`scoring_settings`, with receptions swapped to whatever the draft on screen is
scored at — `scoringFor` — so a standard mock prices a receiver the way that
room does without giving up the league's finer rules. Sleeper's precomputed
`pts_half_ppr` is not used for either half of that: it is a generic preset that
docks an interception 1 point where a league may say 2, enough to misrank every
quarterback by up to 14 points, and six draftable players have no `pts_*` at
all, so reading it would price two of them by a different rule than the players
either side of them. Deep bench players come back with an ADP but no stat line,
and are omitted rather than scored zero.

A projection carries no `depth_chart_order`, which the model once used to spot a
healthy starting quarterback. It uses projected pass attempts instead, which is
a cleaner signal and already in the response: Sleeper projects attempts for 77
quarterbacks and the split is not close — 31 at 300+, 42 under 100, four in
between.

## What a player is worth

The board sorts by ADP, which is what the rest of the league thinks.
`js/value.js` is what you think:

```bash
node bin/board.mjs --user <name>          # the board, best first
node bin/board.mjs --user <name> --plan   # take a back now, or wait a round?
node bin/board.mjs --user <name> --json   # the whole ranked board
```

It prices a player three ways at once — against the lineup you already hold,
against the baseline his position can actually be replaced at, and against what
waiting until your next pick would get you instead:

```
value = gain(player) - wait(position)
```

That last comparison is value-based drafting with a next-available baseline,
which is a decades-old idea. The parts specific to this board are that a season
is priced as seventeen weeks of coverage rather than a starting lineup — so the
third running back is the man who plays the games the first two miss — and that
the replacement baseline turns on whether a position can genuinely be streamed.
Only kickers and defenses can: the gap between the last starting kicker and the
best one on the wire is 0 points, where for a running back it is 102.

[docs/value-formula.md](docs/value-formula.md) is the derivation, with the
numbers and what it was checked against.
[docs/drafting-goals.md](docs/drafting-goals.md) is why these are the right
questions.

## Grades

`data/grades.json` holds the four things a projection can't tell us: how good
the offense is, how secure the role is, how many games he'll actually play, and
how much room sits above the mean case. Nothing in Sleeper's API answers any of
them, so they're researched rather than fetched — and they are the only data the
board ships rather than reads from Sleeper.

```bash
node bin/grades.mjs queue         # who needs grading, in batches of 25
```

That writes `data/grades/queue-NN.json` — the top 200 by ADP, skipping kickers
and defenses, whose value is flat across the whole draft. Research fills in a
`graded-NN.json` beside each one (the `grade-players` skill in `.claude/skills`
says how, and is written to be run a batch at a time, in parallel), and:

```bash
node bin/grades.mjs build         # graded-*.json -> data/grades.json
node bin/grades.mjs build --check # validate without writing
```

The `graded-*.json` files are the source of truth and `data/grades.json` is
derived from them, so it can be rebuilt at any time and should never be edited
by hand. Files are validated whole: a batch with a grade out of range, an
unknown player, or no sources is rejected entirely and reported rather than
half-loaded, and every other batch still builds — so one bad file is re-run on
its own.

Grades are the one thing here that isn't a plain fetch. Everything else is a
cache: ask twice and nothing changes. Grades are reproducible but not
deterministic — re-running the research gives a different answer, sometimes a
better one. `sources` and `graded_at` are what make one auditable and let a
stale one be spotted; a depth chart in August is not the one from June.

## Tests

The thing worth testing here is not that the arithmetic runs — it is that the
board recommends the right player. So a test is an argument about ordering:
plant a player whose answer is already known, and check where the ranking puts
him.

```bash
bin/test                      # everything
bin/test recommends           # just that file
bin/test "strictly better"    # just the tests whose names match
bin/test --watch              # rerun on save
```

`npm test` is the same thing. A bare word is a file when there is one and a
test name when there isn't; a word that is neither is an error rather than a
green run of nothing, which is what Node's own runner would report.

The suite runs against `test/fixtures/pool.json` — a real pool, priced under a
real league, written down on a day that has passed. Sleeper's ADP and
projections move daily and grades move whenever someone researches a batch, so
a test that fetched either would pass or fail for reasons that have nothing to
do with the formula. Regenerating the fixture is deliberately a thing you do
by hand:

```bash
node bin/fixture.mjs --user <sleeper username>
```

`test/scenario.js` is where a situation gets built. It takes the seat, the
players already gone, the roster we hold, and anything the test wants to plant,
and hands back the board:

```js
const draft = scenario({
  roster: ["Jahmyr Gibbs"],
  plant: [player({ name: "Ringer Reynolds", position: "TE",
                   adp: 40, points: 210 })],
});
assert.equal(draft.pick.name, "Ringer Reynolds");
```

`pick` is the recommendation, `rank` and `value` say where anyone else landed,
and `top()` prints the head of the board so a failure says what it got instead.
Planted players are built by `player()` or by `like()`, which copies a real one
and moves a single number — that is how "just better than the best man on the
board" gets written without restating his whole line.

What these should not do is pin the current numbers down. Values move whenever
the formula is tuned, and a suite that failed on every tuning would be deleted
within a week. The claims worth writing are the ones that have to survive it: a
strictly better player is taken over the man he is better than, a strictly worse
one is not, and a position the roster has already filled stops being the answer.

## Deploying

GitHub Pages serves the repository as-is. There is no build step, so the
workflow in `.github/workflows/pages.yml` uploads the checkout and publishes it.

Two things this depends on, both easy to break later:

- **Paths must stay relative.** A project site lives at
  `<user>.github.io/<repo>/`, so `data/grades.json` resolves and
  `/data/grades.json` would 404.
- **`.nojekyll` must stay.** Without it Pages runs Jekyll, which silently drops
  files and directories beginning with `_`.

Pages cannot set HTTP headers, which costs nothing here: the board never serves
a cross-origin request, it only makes them, and Sleeper sends the permissive
headers itself.
