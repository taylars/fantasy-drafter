"""Serve the draft board over http.

    python3 -m scripts.serve            # http://localhost:8000/draft-board.html
    python3 -m scripts.serve --port 9000
    python3 -m scripts.serve --no-open

draft-board.html reads data/fantasy.db in the browser, and browsers refuse to
fetch a local file from a file:// page — so the board needs a server, even
though it's still a static page. This is that server: the standard library's,
rooted at the repo, and bound to localhost only.

It serves one thing that isn't a file: POST /api/tags, which writes a single
row of player_tags. Tagging is the one opinion formed while looking at the
board rather than before it — holding a row or tapping its star has to land
somewhere that survives a reload, and sql.js in the page can only read.
"""

from __future__ import annotations

import argparse
import functools
import http.server
import json
import pathlib
import socketserver
import sqlite3
import webbrowser

import db

ROOT = pathlib.Path(__file__).resolve().parent.parent
PAGE = "draft-board.html"
DB_FILE = ROOT / "data" / "fantasy.db"

TAGS_API = "/api/tags"
KINDS = ("favorite", "watch")

# A tag is three short ids; anything larger than this is not one.
MAX_BODY = 4096


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

    def do_POST(self) -> None:
        if self.path.split("?")[0] != TAGS_API:
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
            self.reply(200, write_tag(payload))
        except json.JSONDecodeError:
            self.reply(400, {"error": "body isn't json"})
        except ValueError as exc:
            self.reply(400, {"error": str(exc)})
        except sqlite3.Error as exc:
            self.reply(500, {"error": f"couldn't write the tag: {exc}"})

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
    socketserver.TCPServer.allow_reuse_address = True

    with socketserver.TCPServer(("127.0.0.1", args.port), handler) as httpd:
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
