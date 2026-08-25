# Sleeper API — Draft Assistant Reference

Everything needed to build a script that watches a live Sleeper draft and recommends picks.

- **Base URL:** `https://api.sleeper.app/v1`
- **Auth:** none. All endpoints are public GET requests returning JSON.
- **Rate limit:** stay under 1000 calls/minute or risk an IP block.
- **Write access:** none. You can read the draft but cannot submit picks, set a queue, or autodraft. Recommendations only — you still click in the app.

---

## 1. Finding your draft

You need a `draft_id`. Two paths:

```
GET /user/{username}                        → { user_id, display_name, avatar }
GET /user/{user_id}/leagues/nfl/{season}    → [ { league_id, name, draft_id, ... } ]
GET /league/{league_id}/drafts              → [ { draft_id, status, season, ... } ]
```

Or skip leagues entirely:

```
GET /user/{user_id}/drafts/nfl/{season}     → all drafts you're in this season
```

The league object also carries `draft_id` directly for the most recent draft, which is usually the fastest route.

Do this once and hardcode the `draft_id` before draft night. Don't resolve it live.

---

## 2. Draft endpoints

```
GET /draft/{draft_id}                 → draft metadata + status
GET /draft/{draft_id}/picks           → all picks made so far (updates live)
GET /draft/{draft_id}/traded_picks    → traded picks (dynasty/keeper leagues)
```

### Draft object — fields that matter

| Field | Notes |
|---|---|
| `status` | `pre_draft`, `drafting`, `paused`, `complete` |
| `type` | `snake`, `linear`, `auction` |
| `start_time` | epoch ms |
| `last_picked` | epoch ms of the most recent pick — useful for a "seconds on clock" estimate |
| `settings.teams` | number of teams — the modulus for all snake math |
| `settings.rounds` | total rounds |
| `settings.pick_timer` | seconds per pick (0 = no timer) |
| `settings.reversal_round` | non-zero if the league uses 3rd-round reversal or similar |
| `settings.slots_qb` / `slots_rb` / `slots_wr` / `slots_te` / `slots_flex` / `slots_bn` etc. | roster construction — feeds positional need logic |
| `draft_order` | `{ user_id: draft_slot }` |
| `slot_to_roster_id` | `{ draft_slot: roster_id }` |
| `metadata.scoring_type` | e.g. `ppr`, `half_ppr`, `std` |

`draft_order` and `slot_to_roster_id` are `null` until the order is set. Handle that.

### Pick object

Returned as an array, ordered by `pick_no`:

```json
{
  "round": 1,
  "pick_no": 4,
  "draft_slot": 4,
  "roster_id": 4,
  "player_id": "6794",
  "picked_by": "378716407027937280",
  "is_keeper": null,
  "draft_id": "...",
  "metadata": {
    "first_name": "Justin",
    "last_name": "Jefferson",
    "position": "WR",
    "team": "MIN",
    "status": "Active",
    "injury_status": "",
    "years_exp": "2",
    "number": "18"
  }
}
```

Notes:
- Empty array before the draft starts.
- `picked_by` can be an empty string on autopicks.
- Auction drafts put the winning bid in `metadata.amount`.
- The embedded `metadata` means you can identify drafted players without joining against the player file — handy, but you still need the full player file for *undrafted* players.

---

## 3. Deriving "who's on the clock"

Sleeper does **not** give you a current-pick field. Compute it:

```
next_pick_no = len(picks) + 1
round        = ceil(next_pick_no / teams)
idx          = (next_pick_no - 1) % teams          # 0-based position within round
```

**Linear draft:** `draft_slot = idx + 1`

**Snake draft:**
- odd round → `draft_slot = idx + 1`
- even round → `draft_slot = teams - idx`

**Reversal round:** if `settings.reversal_round` is non-zero (say 3), the direction flips again starting that round — rounds 1, 2 behave normally and from round 3 on the parity inverts. Verify against your league's actual first few picks rather than trusting the formula blind.

Then:

```
roster_id = slot_to_roster_id[draft_slot]
user_id   = reverse of draft_order  → who that is
picks_until_my_turn = next_pick_no_for_my_slot - next_pick_no
```

Knowing how many picks until your *next* turn is the single most useful number for recommendations — it determines which players are realistically still going to be there.

---

## 4. Player data

```
GET /players/nfl
```

Returns every player keyed by `player_id`. **~5 MB.** Cache it to disk; call at most once a day, never inside the polling loop.

Per-player fields worth using:

| Field | Notes |
|---|---|
| `full_name`, `position`, `team` | basics |
| `fantasy_positions` | array — a player can be RB/WR eligible |
| `status` | `Active`, `Inactive`, `Injured Reserve`, etc. |
| `injury_status` | `Questionable`, `Out`, `IR`, ... |
| `age`, `years_exp` | for dynasty/rookie weighting |
| `search_rank` | Sleeper's internal relevance rank, low = more relevant. A crude ADP proxy — usable as a fallback but not a substitute for real rankings |
| `depth_chart_order` | starter vs backup signal |

Filter aggressively on load: drop players with no `team`, non-fantasy positions, and anyone `status` inactive. That takes ~11k entries down to something manageable.

### Trending (optional signal)

```
GET /players/nfl/trending/add?lookback_hours=24&limit=25
GET /players/nfl/trending/drop?lookback_hours=24&limit=25
```

Returns `[{ player_id, count }]`. More useful in-season than during a draft.

### Season state

```
GET /state/nfl   → { season, week, season_type, display_week, ... }
```

---

## 5. Live polling pattern

There is **no webhook or push API**. Sleeper's own app uses a WebSocket at `wss://api.sleeper.app/` but it is undocumented and unsupported — fine to poke at for a personal tool, not something to build on.

Polling `/draft/{draft_id}/picks` every 2–3 seconds is far under the rate limit (a 3-second interval is 20 calls/min).

```
1. Load player file from local cache (refresh if older than 24h)
2. Load your rankings (CSV/JSON you control — see §6)
3. Fetch draft object once → teams, rounds, type, slot_to_roster_id, your slot
4. Loop:
     picks = GET /draft/{draft_id}/picks
     if len(picks) == last_seen_count: sleep and continue
     new_picks = picks[last_seen_count:]
     mark those player_ids as drafted
     recompute best available
     if on_the_clock == my_slot: print recommendations loudly
     if picks_until_my_turn <= 2: print a heads-up
     last_seen_count = len(picks)
     sleep 3
```

Diffing on `len(picks)` is cheap and correct as long as picks are never removed. A commissioner *can* undo a pick, so if you want to be safe, diff on the set of `pick_no` values instead and handle shrinkage by rebuilding drafted-set from scratch.

Also poll the draft object occasionally (every ~30s) to catch `status` flipping to `paused` or `complete`.

---

## 6. Recommendation logic — what you have to supply

The API gives you *state*, not *value*. Sleeper exposes no projections or ADP endpoint. You need your own ranking source, loaded from a local file:

```
player_id or name, position, tier, projected_points, adp
```

Getting names to `player_id` is the annoying part — normalize (lowercase, strip punctuation and suffixes like Jr./III) and match on `name + position + team`. Build this mapping *before* draft day and eyeball the failures manually; do not debug fuzzy matching at 8pm on draft night.

Once matched, useful outputs:

- **Best available** by your ranking, minus drafted.
- **Positional scarcity** — how many players remain in the current tier at each position. A tier about to empty before your next pick is the strongest "reach now" signal.
- **Roster needs** — parse your own picks so far against `settings.slots_*` to see what you still must fill.
- **Value vs. ADP** — anyone whose ADP is well past the current pick number is a value.
- **Survival odds** — with `picks_until_my_turn` known, flag players unlikely to last (ADP inside that window).

---

## 7. Gotchas checklist

- [ ] `draft_order` / `slot_to_roster_id` are `null` until the order is set — don't crash pre-draft
- [ ] Keeper leagues: picks with `is_keeper: true` appear before the draft starts
- [ ] `picked_by` is `""` on autopicks — fall back to `roster_id`
- [ ] Don't fetch `/players/nfl` in the loop
- [ ] Verify your snake math against the first round of real picks before trusting it
- [ ] Set a `User-Agent` header; use a timeout and retry on 429/5xx with backoff
- [ ] Mock a draft first (Sleeper mock drafts have real `draft_id`s and hit the same endpoints) — that's your test harness

---

## 8. Minimal Python skeleton

```python
import time, json, math, requests, pathlib

BASE = "https://api.sleeper.app/v1"
DRAFT_ID = "..."          # hardcode before draft night
MY_SLOT = 4
CACHE = pathlib.Path("players_nfl.json")

def get(path):
    r = requests.get(f"{BASE}{path}", timeout=10)
    r.raise_for_status()
    return r.json()

def load_players():
    if not CACHE.exists() or time.time() - CACHE.stat().st_mtime > 86400:
        CACHE.write_text(json.dumps(get("/players/nfl")))
    return json.loads(CACHE.read_text())

def on_the_clock(pick_no, teams, dtype, reversal=0):
    rnd = math.ceil(pick_no / teams)
    idx = (pick_no - 1) % teams
    if dtype == "linear":
        return rnd, idx + 1
    forward = (rnd % 2 == 1)
    if reversal and rnd >= reversal:
        forward = not forward
    return rnd, (idx + 1 if forward else teams - idx)

def main():
    players = load_players()
    draft = get(f"/draft/{DRAFT_ID}")
    teams = draft["settings"]["teams"]
    dtype = draft["type"]
    reversal = draft["settings"].get("reversal_round", 0)

    seen = 0
    while True:
        picks = get(f"/draft/{DRAFT_ID}/picks")
        if len(picks) != seen:
            for p in picks[seen:]:
                m = p.get("metadata", {})
                print(f"{p['pick_no']:>3}. {m.get('first_name','')} "
                      f"{m.get('last_name','')} ({m.get('position')}, {m.get('team')})")
            seen = len(picks)

            nxt = seen + 1
            rnd, slot = on_the_clock(nxt, teams, dtype, reversal)
            drafted = {p["player_id"] for p in picks}
            # TODO: rank undrafted players against your own board
            if slot == MY_SLOT:
                print(f"\n>>> YOU'RE UP — round {rnd}, pick {nxt}\n")
            else:
                print(f"    (on clock: slot {slot}, round {rnd})")
        time.sleep(3)

if __name__ == "__main__":
    main()
```