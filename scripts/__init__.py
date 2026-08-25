"""Loader scripts that populate the SQLite cache from Sleeper.

Run them from the repo root, e.g. `python3 -m scripts.load_all`. Each one is
idempotent — running it twice refreshes rows rather than duplicating them.
"""
