"""Load drafts and picks for every draft a tracked user is in.

    python3 -m scripts.load_drafts
    python3 -m scripts.load_drafts --season 2025
    python3 -m scripts.load_drafts --draft-id 1234567890   # one draft, e.g. a mock
    python3 -m scripts.load_drafts --leagues-only          # skip mocks

**Mock drafts cannot be enumerated through the API.** Verified against a live
mock: it appears in neither /user/{id}/drafts (2026 or 2025) nor the source
league's /drafts, and no undocumented variant returns it either.

A mock started from a league ("league_mock") does still know where it came from
— top-level league_id is null, but metadata.league_id names the source league,
and `creators` lists who opened it. Both are stored, so a mock can be joined to
its league's scoring and roster settings.

Since they can't be discovered, a mock is registered once by the id in its URL:

    https://sleeper.com/draft/nfl/<draft_id>
    python3 -m scripts.load_drafts --draft-id <draft_id>

After that it's a row in the drafts table like any other, and plain
`load_drafts` keeps refreshing it. Mocks store league_id null and is_mock = 1.
They hit exactly the same endpoints as a real draft, which makes them the right
thing to point the live draft loop at for testing.

Picks are replaced rather than merged: a commissioner can undo a pick, so a
straight upsert would leave a phantom row behind for a pick that no longer
exists. Deleting the ones Sleeper no longer reports keeps the table honest.
"""

from __future__ import annotations

import argparse

import db
from client.sleeper import SleeperClient


def load_draft(conn, sleeper, draft_id: str, draft: dict | None = None) -> None:
    """Upsert one draft and its picks. Pass `draft` to reuse an already-fetched object."""
    draft = draft or sleeper.get_draft(draft_id)
    if not draft:
        print(f"  {draft_id}: not found")
        return

    settings = draft.get("settings") or {}
    metadata = draft.get("metadata") or {}
    league_id = draft.get("league_id")
    db.upsert(
        conn,
        "drafts",
        {
            "draft_id": draft["draft_id"],
            "league_id": league_id,
            "is_mock": int(league_id is None),
            "mock_type": metadata.get("type"),
            # A league mock points back at the league it copied its settings
            # from, which is how we join it to that league's scoring rules.
            "source_league_id": metadata.get("league_id") if league_id is None else None,
            "creators": db.as_json(draft.get("creators")),
            "season": draft.get("season"),
            "sport": draft.get("sport"),
            "type": draft.get("type"),
            "status": draft.get("status"),
            "start_time": draft.get("start_time"),
            "last_picked": draft.get("last_picked"),
            "teams": settings.get("teams"),
            "rounds": settings.get("rounds"),
            "pick_timer": settings.get("pick_timer"),
            "reversal_round": settings.get("reversal_round"),
            "scoring_type": metadata.get("scoring_type"),
            # Both are null until the draft order is set — store the null.
            "draft_order": db.as_json(draft.get("draft_order")),
            "slot_to_roster_id": db.as_json(draft.get("slot_to_roster_id")),
            "settings": db.as_json(settings),
            "fetched_at": db.now(),
        },
        keys=("draft_id",),
    )

    picks = sleeper.get_draft_picks(draft_id)
    for pick in picks:
        db.upsert(
            conn,
            "draft_picks",
            {
                "draft_id": draft_id,
                "pick_no": pick["pick_no"],
                "round": pick.get("round"),
                "draft_slot": pick.get("draft_slot"),
                "roster_id": pick.get("roster_id"),
                "player_id": pick.get("player_id"),
                "picked_by": pick.get("picked_by"),
                "is_keeper": pick.get("is_keeper"),
                "metadata": db.as_json(pick.get("metadata")),
                "fetched_at": db.now(),
            },
            keys=("draft_id", "pick_no"),
        )

    live = [p["pick_no"] for p in picks]
    placeholders = ", ".join("?" * len(live))
    removed = conn.execute(
        f"DELETE FROM draft_picks WHERE draft_id = ?"
        + (f" AND pick_no NOT IN ({placeholders})" if live else ""),
        [draft_id, *live],
    ).rowcount

    note = f", {removed} stale pick(s) removed" if removed else ""
    kind = metadata.get("type", "mock") if league_id is None else "league"
    print(f"  {draft_id} [{kind}]: {draft.get('status')}, {len(picks)} pick(s){note}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--draft-id", default=None, help="load a single draft (use this for a mock)")
    parser.add_argument("--season", default=None, help="season year (defaults to current)")
    parser.add_argument("--leagues-only", action="store_true", help="skip mock drafts")
    args = parser.parse_args()

    conn = db.connect()
    db.init(conn)

    with SleeperClient() as sleeper:
        if args.draft_id:
            load_draft(conn, sleeper, args.draft_id)
            conn.commit()
            conn.close()
            return

        season = args.season or (sleeper.get_state() or {}).get("season")
        users = db.tracked_users(conn)

        # Three sources, in order of what they're good for:
        #   1. drafts already cached — this is what keeps a registered mock fresh
        #   2. the leagues table — new leagues loaded since the last run
        #   3. /user/{id}/drafts — league drafts, and a check on the above
        found: dict[str, dict | None] = {}
        for row in conn.execute("SELECT draft_id FROM drafts"):
            found.setdefault(row["draft_id"], None)
        for row in conn.execute("SELECT draft_id FROM leagues WHERE draft_id IS NOT NULL"):
            found.setdefault(row["draft_id"], None)
        for user in users:
            for draft in sleeper.get_user_drafts(user["user_id"], season):
                found.setdefault(draft["draft_id"], draft)

        if not found:
            print("nothing to load — run `python3 -m scripts.load_leagues` first,")
            print("or register a mock with --draft-id <id>")
            return

        if args.leagues_only:
            mocks = [r["draft_id"] for r in conn.execute("SELECT draft_id FROM drafts WHERE is_mock = 1")]
            found = {k: v for k, v in found.items() if k not in mocks}

        print(f"season {season}: {len(found)} draft(s)")
        for draft_id, draft in found.items():
            load_draft(conn, sleeper, draft_id, draft)

    conn.commit()
    conn.close()


if __name__ == "__main__":
    main()
