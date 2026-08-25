"""Serve the draft board over http.

    python3 -m scripts.serve            # http://localhost:8000/draft-board.html
    python3 -m scripts.serve --port 9000
    python3 -m scripts.serve --no-open

draft-board.html reads data/fantasy.db in the browser, and browsers refuse to
fetch a local file from a file:// page — so the board needs a server, even
though it's still a static page. This is that server: the standard library's,
rooted at the repo, and bound to localhost only.
"""

from __future__ import annotations

import argparse
import functools
import http.server
import pathlib
import socketserver
import webbrowser

ROOT = pathlib.Path(__file__).resolve().parent.parent
PAGE = "draft-board.html"


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
