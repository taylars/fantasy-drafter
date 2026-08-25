"""Measure how long a pick takes to reach us, against Sleeper's own clock.

    python3 -m scripts.watch_draft <draft_id>
    python3 -m scripts.watch_draft <draft_id> --interval 1
    python3 -m scripts.watch_draft <draft_id> --no-compare

Built to answer one question the board can't answer about itself: when the
board looks behind a live draft, is that us polling too slowly, or Sleeper's
API handing out a stale answer?

Picks carry no timestamp, but the draft object carries `last_picked` — epoch
milliseconds from Sleeper's own servers, recorded when the pick was made. So
for every pick that appears we can print the gap between when Sleeper says it
happened and when we first managed to see it, with no stopwatch involved.

Two clocks are being compared, so the skew between them is measured rather than
assumed: every response carries a `date` header, which is Sleeper's clock at
the moment they answered. The lag figures below are corrected by it, and the
skew is printed at startup so you can see what was subtracted.

By default it polls the picks endpoint twice per tick — once cache-busted, once
plain — and reports how far the plain one trails. That is the CDN's doing, not
ours: the draft endpoints sit behind Cloudflare with `s-maxage=86400`, so a
plain poll can sit on an edge copy for a very long time (see client/sleeper).
--no-compare skips the second request if you'd rather not double the traffic.

Ctrl-C prints the summary. Nothing here writes to the database.
"""

from __future__ import annotations

import argparse
import email.utils
import time

from client.sleeper import BASE_URL, CACHE_BUSTER, SleeperClient


def server_time(response) -> float | None:
    """Sleeper's clock when they answered, as a unix timestamp."""
    date = response.headers.get("date")
    return email.utils.parsedate_to_datetime(date).timestamp() if date else None


def fetch(session, draft_id: str, path: str = "/picks", fresh: bool = True):
    """One raw GET, returning (json, response) so headers stay visible.

    The client wrapper returns decoded json alone, which is the right shape for
    everything else and the wrong one here: cf-cache-status and date are half
    of what this script is for.
    """
    url = f"{BASE_URL}/draft/{draft_id}{path}"
    params = {CACHE_BUSTER: int(time.time() * 1000)} if fresh else {}
    response = session.get(url, params=params, timeout=10)
    response.raise_for_status()
    return response.json(), response


def fmt(ts: float) -> str:
    return time.strftime("%H:%M:%S", time.localtime(ts)) + f".{int(ts % 1 * 1000):03d}"


def watch(draft_id: str, interval: float, compare: bool,
          lags: list[float], behind: list[int]) -> None:
    seen: set[int] = set()
    skew = 0.0
    first_tick = True

    with SleeperClient() as client:
        session = client.session

        # Skew first, so every lag printed below is already corrected by it.
        _, probe = fetch(session, draft_id)
        theirs = server_time(probe)
        if theirs:
            skew = theirs - time.time()
            print(f"clock skew: Sleeper is {skew:+.1f}s from this machine "
                  f"(subtracted from every lag below)")

        draft, _ = fetch(session, draft_id, path="", fresh=True)
        print(f"watching {draft_id}: {draft.get('status')}, "
              f"{draft.get('settings', {}).get('teams')} teams, "
              f"polling every {interval}s"
              + (", comparing against the plain (cached) endpoint" if compare else ""))
        print("waiting for picks — ctrl-c for the summary\n")

        while True:
            tick = time.time()

            picks, _ = fetch(session, draft_id, fresh=True)
            new = [p for p in picks if p["pick_no"] not in seen]

            # Whatever was already there when we attached is backlog, not news.
            # It can't be timed either: last_picked dates the newest pick only,
            # so printing the lot would be a wall of rows with no lag on them.
            if first_tick:
                seen.update(p["pick_no"] for p in picks)
                print(f"starting from pick {len(picks)} — "
                      f"only picks made from here are timed\n")
                first_tick = False
                new = []

            if new:
                # last_picked belongs to the newest pick, so it only dates the
                # last one in a batch. Older ones in the same tick get no lag
                # figure rather than a borrowed and wrong one.
                draft, _ = fetch(session, draft_id, path="", fresh=True)
                last_picked = draft.get("last_picked")
                newest = max(p["pick_no"] for p in new)

                for pick in sorted(new, key=lambda p: p["pick_no"]):
                    seen.add(pick["pick_no"])
                    meta = pick.get("metadata") or {}
                    who = f"{meta.get('first_name','?')} {meta.get('last_name','?')}"
                    line = (f"[{fmt(tick)}] pick {pick['pick_no']:>3}  "
                            f"{who[:22]:22} {meta.get('position','') :>3}")

                    if pick["pick_no"] == newest and isinstance(last_picked, int):
                        lag = (tick + skew) - last_picked / 1000
                        lags.append(lag)
                        line += f"  sleeper: {fmt(last_picked/1000)}  lag {lag:5.1f}s"
                    print(line)

            if compare:
                plain, response = fetch(session, draft_id, fresh=False)
                seen_plain = {p["pick_no"] for p in plain}
                gap = len(seen) - len(seen_plain)
                if new or gap:
                    age = response.headers.get("age", "-")
                    behind.append(gap)
                    print(f"{'':11}  plain endpoint: {len(seen_plain):>3} picks "
                          f"({gap:+d} vs fresh)  cf={response.headers.get('cf-cache-status')} "
                          f"age={age}s")

            time.sleep(max(0.0, interval - (time.time() - tick)))


def summarize(lags: list[float], behind: list[int], elapsed: float) -> None:
    print(f"\n{'-' * 62}")
    print(f"watched for {elapsed/60:.1f} min, {len(lags)} pick(s) timed")
    if lags:
        ordered = sorted(lags)
        print(f"pick -> us:   median {ordered[len(ordered)//2]:.1f}s   "
              f"min {ordered[0]:.1f}s   max {ordered[-1]:.1f}s")
        print("              (Sleeper's own last_picked to our first sighting,")
        print("               so it includes their propagation and our poll wait)")
    if behind:
        worst = max(behind)
        print(f"cached copy:  trailed by up to {worst} pick(s) "
              f"while we were cache-busting past it")
    if not lags:
        print("no picks landed while watching — nothing to report")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("draft_id", help="the numeric id from the draft url")
    parser.add_argument("--interval", type=float, default=1.0,
                        help="seconds between polls (default 1, finer than the board's 3)")
    parser.add_argument("--no-compare", dest="compare", action="store_false",
                        help="don't also poll the plain, CDN-cached endpoint")
    args = parser.parse_args()

    lags: list[float] = []
    behind: list[int] = []
    started = time.time()

    # The summary is the point of running this, so make sure ctrl-c reaches it.
    try:
        watch(args.draft_id, args.interval, args.compare, lags, behind)
    except KeyboardInterrupt:
        print()
    finally:
        summarize(lags, behind, time.time() - started)


if __name__ == "__main__":
    main()
