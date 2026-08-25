"""Read-only client for the Sleeper API.

Docs: https://docs.sleeper.com/ — that's the source of truth, not this file.

Everything here is a public GET: no auth, no writes. You can read a draft but
cannot submit picks, set a queue, or autodraft. Stay under 1000 calls/minute.

Gotchas worth knowing before you build on this:
  - There is no push API. Poll /draft/{id}/picks every 2-3s during a draft
    (3s = 20 calls/min, comfortably under the limit) and poll the draft object
    every ~30s to catch status flipping to paused/complete.
  - `draft_order` and `slot_to_roster_id` are null until the order is set.
  - `picked_by` is "" on autopicks — fall back to `roster_id`.
  - A commissioner can undo a pick, so diff on the set of `pick_no` values
    rather than on len(picks) if you want to survive that.
  - Keeper leagues show picks with `is_keeper: true` before the draft starts.
  - Projections and ADP live on api.sleeper.app/projections/..., which is NOT
    in the public docs and can change without notice. get_projections wraps it.
    `search_rank` on the player object is only a relevance proxy — prefer the
    real ADP from that endpoint.
"""

from __future__ import annotations

import json
import math
import pathlib
import time

import requests

BASE_URL = "https://api.sleeper.app/v1"
USER_AGENT = "fantasy-drafter/0.1 (personal draft helper)"

# The full player file is ~5 MB. Cache it on disk and refresh at most daily.
PLAYER_CACHE = pathlib.Path("data/players_nfl.json")
PLAYER_CACHE_MAX_AGE = 24 * 60 * 60

RETRY_STATUSES = {429, 500, 502, 503, 504}


class SleeperError(RuntimeError):
    """A request to Sleeper failed after exhausting retries."""


class SleeperClient:
    """Thin wrapper over the Sleeper REST endpoints.

    All methods return the decoded JSON as-is; shaping the data into something
    draft-board-friendly is the caller's job.
    """

    def __init__(self, timeout: float = 10.0, retries: int = 3) -> None:
        self.timeout = timeout
        self.retries = retries
        # One session for the life of the client: keep-alive matters when the
        # draft loop polls every few seconds.
        self.session = requests.Session()
        self.session.headers["User-Agent"] = USER_AGENT

    def close(self) -> None:
        self.session.close()

    def __enter__(self) -> "SleeperClient":
        return self

    def __exit__(self, *exc_info) -> None:
        self.close()

    # ------------------------------------------------------------------ core

    def get(self, path: str, **params) -> dict | list | None:
        """GET a path relative to the API base, retrying on 429/5xx.

        Returns None for a 404 — Sleeper uses it for unknown users and leagues,
        which is a normal miss rather than an error.
        """
        url = f"{BASE_URL}{path}"

        last_error: Exception | None = None
        for attempt in range(self.retries):
            if attempt:
                time.sleep(2**attempt)  # 2s, 4s
            try:
                response = self.session.get(url, params=params, timeout=self.timeout)
                if response.status_code == 404:
                    return None
                if response.status_code in RETRY_STATUSES:
                    last_error = requests.HTTPError(f"HTTP {response.status_code}")
                    continue
                response.raise_for_status()
                return response.json()
            except (requests.RequestException, json.JSONDecodeError) as exc:
                last_error = exc

        raise SleeperError(f"GET {url} failed: {last_error}") from last_error

    # ----------------------------------------------------------------- users

    def get_user(self, username_or_id: str) -> dict | None:
        """Look up a user by username or user_id → {user_id, display_name, ...}."""
        return self.get(f"/user/{username_or_id}")

    def get_user_leagues(self, user_id: str, season: str | int, sport: str = "nfl") -> list:
        """Every league the user is in for a season. Each carries its draft_id."""
        return self.get(f"/user/{user_id}/leagues/{sport}/{season}") or []

    def get_user_drafts(self, user_id: str, season: str | int, sport: str = "nfl") -> list:
        """Every draft the user is in for a season, skipping the league lookup."""
        return self.get(f"/user/{user_id}/drafts/{sport}/{season}") or []

    # --------------------------------------------------------------- leagues

    def get_league(self, league_id: str) -> dict | None:
        """League settings, scoring, roster positions, and the current draft_id."""
        return self.get(f"/league/{league_id}")

    def get_league_users(self, league_id: str) -> list:
        """Managers in the league → user_id, display_name, and team metadata."""
        return self.get(f"/league/{league_id}/users") or []

    def get_league_rosters(self, league_id: str) -> list:
        """Rosters → roster_id, owner_id, and the player_ids on each team."""
        return self.get(f"/league/{league_id}/rosters") or []

    def get_league_drafts(self, league_id: str) -> list:
        """All drafts for a league, newest first (dynasty leagues have several)."""
        return self.get(f"/league/{league_id}/drafts") or []

    # ---------------------------------------------------------------- drafts

    def get_draft(self, draft_id: str) -> dict | None:
        """Draft metadata: status, type, settings, draft_order, slot_to_roster_id.

        status is one of pre_draft / drafting / paused / complete; type is
        snake / linear / auction. settings carries teams, rounds, pick_timer,
        reversal_round, and the slots_* roster construction.
        """
        return self.get(f"/draft/{draft_id}")

    def get_draft_picks(self, draft_id: str) -> list:
        """Picks made so far, ordered by pick_no. Empty before the draft starts.

        Each pick embeds a `metadata` dict (name, position, team, injury_status),
        so drafted players can be identified without joining the player file.
        Auction drafts put the winning bid in `metadata.amount`.
        """
        return self.get(f"/draft/{draft_id}/picks") or []

    def get_draft_traded_picks(self, draft_id: str) -> list:
        """Traded picks for the draft (dynasty/keeper leagues)."""
        return self.get(f"/draft/{draft_id}/traded_picks") or []

    # --------------------------------------------------------------- players

    def get_all_players(
        self,
        sport: str = "nfl",
        cache_path: pathlib.Path = PLAYER_CACHE,
        max_age: float = PLAYER_CACHE_MAX_AGE,
    ) -> dict:
        """Every player keyed by player_id, served from a local cache.

        Refetches only when the cache is missing or older than max_age. Never
        call this inside a polling loop.
        """
        if cache_path.exists() and time.time() - cache_path.stat().st_mtime < max_age:
            return json.loads(cache_path.read_text())

        players = self.get(f"/players/{sport}") or {}
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        cache_path.write_text(json.dumps(players))
        return players

    def get_projections(
        self,
        season: str | int,
        week: int | None = None,
        sport: str = "nfl",
        season_type: str = "regular",
        positions: tuple[str, ...] = ("QB", "RB", "WR", "TE", "K", "DEF"),
        order_by: str = "adp_half_ppr",
    ) -> list:
        """Season or weekly projections, including the ADP set.

        Undocumented: this hangs off api.sleeper.app/projections rather than the
        /v1 base every other method here uses, and Sleeper makes no promises
        about it. Treat a shape change as expected rather than exceptional — the
        loader reads keys defensively for that reason.

        Omit `week` for season totals. Each record carries a `stats` dict holding
        both the projected line (pass_yd, rec, rush_td...) and every adp_* format;
        keys match those in a league's scoring_settings, so db.score_stats can
        price the line directly. Not every record has projections — deep bench
        players come back with ADP alone.
        """
        path = f"/projections/{sport}/{season}"
        if week is not None:
            path = f"{path}/{week}"

        # Positions repeat as position[]=QB&position[]=RB; requests renders a
        # list under that key exactly that way.
        params = {"season_type": season_type, "position[]": list(positions), "order_by": order_by}

        url = f"https://api.sleeper.app{path}"
        last_error: Exception | None = None
        for attempt in range(self.retries):
            if attempt:
                time.sleep(2**attempt)
            try:
                response = self.session.get(url, params=params, timeout=self.timeout)
                if response.status_code == 404:
                    return []
                if response.status_code in RETRY_STATUSES:
                    last_error = requests.HTTPError(f"HTTP {response.status_code}")
                    continue
                response.raise_for_status()
                return response.json() or []
            except (requests.RequestException, json.JSONDecodeError) as exc:
                last_error = exc

        raise SleeperError(f"GET {url} failed: {last_error}") from last_error

    def get_trending_players(
        self,
        kind: str = "add",
        sport: str = "nfl",
        lookback_hours: int = 24,
        limit: int = 25,
    ) -> list:
        """Most-added or most-dropped players → [{player_id, count}]."""
        return (
            self.get(
                f"/players/{sport}/trending/{kind}",
                lookback_hours=lookback_hours,
                limit=limit,
            )
            or []
        )

    def get_state(self, sport: str = "nfl") -> dict | None:
        """Current season and week → {season, week, season_type, ...}."""
        return self.get(f"/state/{sport}")


# --------------------------------------------------------------------- helpers


def fantasy_relevant(players: dict, positions: tuple[str, ...] = ("QB", "RB", "WR", "TE", "K", "DEF")) -> dict:
    """Trim the ~12k-entry player file down to the fantasy positions.

    Position is the only filter. Being off a roster is deliberately not one:
    the projections endpoint publishes ADP for players Sleeper currently lists
    as free agents, and `player_projections` keys off this table — so dropping
    them here would silently drop their ADP too. Injured players stay for the
    same reason; they still get drafted.
    """
    wanted = set(positions)
    return {
        player_id: player
        for player_id, player in players.items()
        if wanted & set(player.get("fantasy_positions") or [])
    }


def on_the_clock(pick_no: int, teams: int, draft_type: str, reversal_round: int = 0) -> tuple[int, int]:
    """Return (round, draft_slot) for a 1-based overall pick number.

    Sleeper has no current-pick field, so this is derived. Verify it against the
    first round of real picks before trusting it — reversal rounds are fiddly.
    """
    rnd = math.ceil(pick_no / teams)
    idx = (pick_no - 1) % teams
    if draft_type == "linear":
        return rnd, idx + 1

    forward = rnd % 2 == 1
    if reversal_round and rnd >= reversal_round:
        forward = not forward
    return rnd, (idx + 1 if forward else teams - idx)


def _summarize(client: SleeperClient, username: str, season: str) -> None:
    """Print a quick smoke test of the three main areas: user, league, draft."""
    user = client.get_user(username)
    if not user:
        print(f"No such user: {username}")
        return
    print(f"user     {user['display_name']} ({user['user_id']})")

    leagues = client.get_user_leagues(user["user_id"], season)
    print(f"leagues  {len(leagues)} in {season}")
    for league in leagues:
        print(f"  - {league['name']} ({league['league_id']}) draft={league.get('draft_id')}")

    if not leagues:
        return

    draft_id = leagues[0].get("draft_id")
    if not draft_id:
        return

    draft = client.get_draft(draft_id)
    picks = client.get_draft_picks(draft_id)
    teams = draft["settings"]["teams"]
    print(f"draft    {draft['type']} · {teams} teams · status={draft['status']} · {len(picks)} picks in")

    rnd, slot = on_the_clock(len(picks) + 1, teams, draft["type"], draft["settings"].get("reversal_round", 0))
    print(f"on clock round {rnd}, slot {slot}")


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Poke at the Sleeper API.")
    parser.add_argument("username", help="Sleeper username")
    parser.add_argument("--season", default=None, help="season year (defaults to current)")
    args = parser.parse_args()

    sleeper = SleeperClient()
    season = args.season or (sleeper.get_state() or {}).get("season")
    _summarize(sleeper, args.username, season)
