"""Serve the draft board over http.

    python3 -m scripts.serve            # http://localhost:8000/draft-board.html
    python3 -m scripts.serve --port 9000
    python3 -m scripts.serve --no-open

draft-board.html reads data/fantasy.db in the browser, and browsers refuse to
fetch a local file from a file:// page — so the board needs a server, even
though it's still a static page. This is that server: the standard library's,
rooted at the repo, and bound to localhost only.

It serves two things that aren't files. POST /api/tags writes a single row of
player_tags: tagging is the one opinion formed while looking at the board
rather than before it, and sql.js in the page can only read. GET /api/value
returns what each player is worth right now, and with ?refresh=1 pulls the
draft's picks from Sleeper first — which is what the live button on the board
polls every few seconds while a draft is running. That cadence is why requests
are served on threads and why the Sleeper session is shared rather than rebuilt
per request: a poll that has to queue behind another one is a board falling
behind the draft it is meant to be tracking.

Value is computed here rather than in the page on purpose. The board already
mirrors one thing from the database (`scoreStats`), and that duplication has a
cost every time scoring changes; mirroring the whole value formula would be a
second copy of something far larger, drifting from `value.py` the first time
either was touched.
"""

from __future__ import annotations

import argparse
import functools
import http.server
import json
import pathlib
import socketserver
import sqlite3
import threading
import time
import urllib.parse
import webbrowser

import db
import value as value_model
from client.sleeper import SleeperClient
from scripts.load_drafts import load_draft

ROOT = pathlib.Path(__file__).resolve().parent.parent
PAGE = "draft-board.html"
DB_FILE = ROOT / "data" / "fantasy.db"

TAGS_API = "/api/tags"
VALUE_API = "/api/value"
DRAFTS_API = "/api/drafts"
KINDS = ("favorite", "watch")

# How many players the value endpoint prices. The board shows every player with
# an ADP, but the ones worth a number are the ones anywhere near being picked —
# and past a couple of hundred the differences are under a point anyway.
VALUE_LIMIT = 250

# A tag is three short ids; anything larger than this is not one.
MAX_BODY = 4096

# How long the draft object is reused before it's fetched again. Sleeper has no
# push API, and client/sleeper.py documents the cadence this is built around:
# picks every 2-3s, the draft object every ~30s to catch status flipping to
# paused or complete. Refetching the draft object on every poll doubles both
# the calls and the round-trip for fields that change twice in a draft.
DRAFT_MAX_AGE = 30.0

# One client for every poll, not one per poll. SleeperClient holds a session
# precisely so a draft loop doesn't pay for a TLS handshake every few seconds
# — building a new one each request threw that away. The lock is what makes
# the single session safe now that requests are served on threads, and it
# doubles as the serializer for the writes the refresh does.
_sleeper_lock = threading.Lock()
_sleeper: SleeperClient | None = None

# draft_id -> (monotonic time it was fetched, the draft object)
_draft_cache: dict[str, tuple[float, dict]] = {}


def sleeper_client() -> SleeperClient:
    """The one Sleeper client, built on first use. Call under _sleeper_lock."""
    global _sleeper
    if _sleeper is None:
        _sleeper = SleeperClient()
    return _sleeper


def write_tag(payload: dict) -> dict:
    """Tag one player in one league, or untag him when kind is null.

    Mirrors what load_watchlist writes, so a tag made on the board and a tag
    loaded from watchlist.json are the same row — and re-running the loader
    still replaces this league's tags wholesale.
    """
    league_id = payload.get("league_id")
    player_id = payload.get("player_id")
    kind = payload.get("kind")

    if not isinstance(league_id, str) or not isinstance(player_id, str):
        raise ValueError("league_id and player_id are required")
    if kind is not None and kind not in KINDS:
        raise ValueError(f"kind must be null, {' or '.join(KINDS)}")

    tagged_at = db.now()
    conn = db.connect(DB_FILE)
    try:
        if kind is None:
            conn.execute(
                "DELETE FROM player_tags WHERE league_id = ? AND player_id = ?",
                (league_id, player_id),
            )
        else:
            db.upsert(
                conn,
                "player_tags",
                {
                    "league_id": league_id,
                    "player_id": player_id,
                    "kind": kind,
                    "tagged_at": tagged_at,
                },
                keys=("league_id", "player_id"),
            )
        conn.commit()
    except sqlite3.IntegrityError as exc:
        # Foreign keys are on, so this is an id the cache doesn't know.
        raise ValueError(f"unknown league or player: {exc}") from exc
    finally:
        conn.close()

    return {"league_id": league_id, "player_id": player_id, "kind": kind,
            "tagged_at": None if kind is None else tagged_at}


def register_draft(payload: dict) -> dict:
    """Fetch a mock draft by id and add it to one league's picker.

    Mock drafts can't be enumerated (see scripts/load_drafts), so this is how
    one joins the cache: paste its id in from the board, fetch it once, and
    load_drafts keeps it fresh from then on like any other draft.
    """
    draft_id = payload.get("draft_id")
    league_id = payload.get("league_id")
    if not isinstance(draft_id, str) or not draft_id.isdigit():
        raise ValueError("draft_id must be the numeric id from the draft url")
    if not isinstance(league_id, str):
        raise ValueError("league_id is required")

    conn = db.connect(DB_FILE)
    try:
        with _sleeper_lock:
            sleeper = sleeper_client()
            draft = sleeper.get_draft(draft_id)
            if not draft:
                raise LookupError(f"no such draft: {draft_id}")
            load_draft(conn, sleeper, draft_id, draft)

            # A mock started cold, not from a league, carries no league_id and
            # no metadata.league_id either — nothing in it points back to us.
            # Tie it to the league it was pasted in from so it shows up in that
            # picker.
            metadata = draft.get("metadata") or {}
            if draft.get("league_id") is None and not metadata.get("league_id"):
                conn.execute(
                    "UPDATE drafts SET source_league_id = ? "
                    "WHERE draft_id = ? AND source_league_id IS NULL",
                    (league_id, draft_id),
                )
            conn.commit()

        row = conn.execute(
            "SELECT draft_id, is_mock, mock_type, type, status, rounds, teams,"
            "       start_time, reversal_round, draft_order,"
            "       (SELECT count(*) FROM draft_picks p WHERE p.draft_id = drafts.draft_id) AS picks"
            "  FROM drafts WHERE draft_id = ?", (draft_id,),
        ).fetchone()
    finally:
        conn.close()

    return dict(row)


def refresh_picks(draft_id: str) -> None:
    """Pull this draft's picks from Sleeper into the cache.

    The board reads a copy of the database that was downloaded when the page
    loaded, so it cannot see a pick made since. This is the only way new picks
    reach it mid-draft — and it is why the live button polls the server rather
    than re-reading the file it already has.

    Picks are fetched every time; the draft object is reused for DRAFT_MAX_AGE.
    Only one refresh runs at a time, so a burst of polls costs one trip to
    Sleeper rather than several racing each other into the same table.
    """
    with _sleeper_lock:
        sleeper = sleeper_client()

        now = time.monotonic()
        cached = _draft_cache.get(draft_id)
        draft = cached[1] if cached and now - cached[0] < DRAFT_MAX_AGE else None
        if draft is None:
            draft = sleeper.get_draft(draft_id)
            if draft:
                _draft_cache[draft_id] = (now, draft)

        conn = db.connect(DB_FILE)
        try:
            load_draft(conn, sleeper, draft_id, draft, quiet=True)
            conn.commit()
        finally:
            conn.close()


def value_payload(league_id: str, draft_id: str, refresh: bool) -> dict:
    """What every available player is worth, and the draft state behind it.

    Returns the picks as well as the values. The page needs both to update
    without reloading: the picks say who to strike through and which slots are
    ours, and the values are what those picks just changed.
    """
    if refresh:
        refresh_picks(draft_id)

    conn = db.connect(DB_FILE)
    try:
        ranked, roster, upcoming = value_model.board(conn, league_id, draft_id,
                                                     limit=VALUE_LIMIT)
        picks = [dict(row) for row in conn.execute(
            "SELECT player_id, picked_by, pick_no, round FROM draft_picks "
            "WHERE draft_id = ? ORDER BY pick_no", (draft_id,))]
    finally:
        conn.close()

    # `row.value` is the canonical recommendation score: this starting
    # choice's mean team value over its modeled continuations, less the mean
    # of all modeled plans. It is already an edge, so do not derive another
    # score from the best alternative. The best-plan edge is tooltip context
    # only; it never affects the recommendation.
    return {
        "league_id": league_id,
        "draft_id": draft_id,
        "at_pick": len(picks) + 1,
        "picks": picks,
        "upcoming": upcoming,
        "roster": [p.player_id for p in roster],
        "values": [
            {"player_id": row.player.player_id,
             "value": round(row.value, 1),
             "edge": round(row.value, 1),
             "gain": round(row.gain, 1),
             "option": round(row.option, 1),
             "best_plan_edge": round(row.best_plan - row.overall_average, 1),
             "graded": row.player.graded}
            for row in ranked
        ],
    }


class Server(socketserver.ThreadingTCPServer):
    """One thread per request, so a slow Sleeper call blocks only its own poll.

    Served from a single thread, a draft object that took ten seconds to come
    back held up everything queued behind it — including the next poll, which
    is how a board falls minutes behind a draft that is still moving. Threads
    are cheap here because the handlers barely share anything: each opens its
    own sqlite connection, and the one piece of shared state, the Sleeper
    session, is taken under _sleeper_lock.
    """

    allow_reuse_address = True
    daemon_threads = True


class Handler(http.server.SimpleHTTPRequestHandler):
    """Static files, with the caching turned off.

    The database changes every time a loader runs, and a cached copy of it is
    a board showing yesterday's opinions — so nothing here is cacheable.
    """

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt: str, *args) -> None:
        # One line per request is noise; failures are what's worth seeing.
        if not str(args[1] if len(args) > 1 else "").startswith("2"):
            super().log_message(fmt, *args)

    def do_GET(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path != VALUE_API:
            super().do_GET()
            return

        query = urllib.parse.parse_qs(parsed.query)
        league_id = (query.get("league") or [None])[0]
        draft_id = (query.get("draft") or [None])[0]
        refresh = (query.get("refresh") or ["0"])[0] not in ("0", "", "false")

        if not league_id or not draft_id:
            self.reply(400, {"error": "league and draft are required"})
            return
        try:
            self.reply(200, value_payload(league_id, draft_id, refresh))
        except LookupError as exc:
            self.reply(404, {"error": str(exc)})
        except sqlite3.Error as exc:
            self.reply(500, {"error": f"couldn't read the cache: {exc}"})
        except Exception as exc:
            # A live draft is the worst time to lose the board to a traceback:
            # Sleeper can time out or change shape, and the page should be told
            # so it can keep the light on and try again on the next tick.
            self.reply(502, {"error": f"{type(exc).__name__}: {exc}"})

    def do_POST(self) -> None:
        path = self.path.split("?")[0]
        if path not in (TAGS_API, DRAFTS_API):
            self.send_error(404, "no such endpoint")
            return
        # Insisting on a json body is what keeps another page from posting
        # here: a cross-origin json POST is preflighted, and nothing in this
        # server answers a preflight. Same-origin fetch from the board is
        # unaffected.
        if not self.headers.get("Content-Type", "").startswith("application/json"):
            self.reply(415, {"error": "send application/json"})
            return
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            self.reply(400, {"error": "bad Content-Length"})
            return
        if length > MAX_BODY:
            self.reply(413, {"error": "body too large"})
            return

        try:
            payload = json.loads(self.rfile.read(length) or b"{}")
            if not isinstance(payload, dict):
                raise ValueError("expected a json object")
            if path == TAGS_API:
                self.reply(200, write_tag(payload))
            else:
                self.reply(200, register_draft(payload))
        except json.JSONDecodeError:
            self.reply(400, {"error": "body isn't json"})
        except ValueError as exc:
            self.reply(400, {"error": str(exc)})
        except LookupError as exc:
            self.reply(404, {"error": str(exc)})
        except sqlite3.Error as exc:
            self.reply(500, {"error": f"couldn't write to the cache: {exc}"})
        except Exception as exc:
            # Sleeper is a third party mid-request here too; don't lose a
            # pasted url to a bare traceback if it times out or 5xxs.
            self.reply(502, {"error": f"{type(exc).__name__}: {exc}"})

    def reply(self, status: int, payload: dict) -> None:
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8000, help="port to listen on")
    parser.add_argument("--no-open", action="store_true", help="don't open a browser")
    args = parser.parse_args()

    if not (ROOT / "data" / "fantasy.db").exists():
        print("warning: no data/fantasy.db yet — run `python3 -m scripts.load_all` first\n")

    url = f"http://localhost:{args.port}/{PAGE}"
    handler = functools.partial(Handler, directory=str(ROOT))

    with Server(("127.0.0.1", args.port), handler) as httpd:
        print(f"draft board at {url}")
        print("ctrl-c to stop")
        if not args.no_open:
            webbrowser.open(url)
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nstopped")


if __name__ == "__main__":
    main()
