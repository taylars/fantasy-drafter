/* The value model, off the main thread.
 *
 * Pricing a board is a few hundred milliseconds of arithmetic — a plan search
 * four picks deep, branching over six positions, each branch ranking a whole
 * position against the roster it would leave behind. That is not long, but it
 * is far too long to spend on the thread that has to keep the page scrolling,
 * and it happens again every three seconds while a draft is live.
 *
 * The pool is sent once and kept here. It is a megabyte of players, and
 * shipping it across on every poll would cost more in copying than the
 * arithmetic costs to run. Each poll then sends only what actually changed:
 * the picks.
 */

import { situation, board, BOARD_LIMIT } from "./value.js";

let state = null;   // {pool, slots, draft, userIds}

self.onmessage = ({ data }) => {
  const { id, type, payload } = data;

  try {
    if (type === "init") {
      state = {
        pool: payload.pool,
        slots: payload.slots,
        draft: payload.draft,
        userIds: new Set(payload.userIds),
      };
      self.postMessage({ id, ok: true, result: { players: state.pool.length } });
      return;
    }

    if (type === "price") {
      if (!state) throw new Error("priced before the pool was sent");
      const gone = new Set(payload.gone);
      const ours = new Set(payload.ours);
      const sit = situation({
        pool: state.pool,
        slots: state.slots,
        draft: payload.draft ?? state.draft,
        gone, ours,
        atPick: payload.atPick,
        userIds: state.userIds,
      });
      const { ranked, upcoming } = board(sit, { limit: payload.limit ?? BOARD_LIMIT });

      // Only what the page draws. The Player objects carry a memoised
      // `_adjusted` and everything the formula needed; sending them back whole
      // would be copying the pool a second time to redraw one column.
      self.postMessage({
        id, ok: true,
        result: {
          atPick: sit.atPick,
          upcoming,
          roster: sit.roster.map((p) => p.player_id),
          values: ranked.map((r) => ({
            player_id: r.player.player_id,
            value: Math.round(r.value * 10) / 10,
            gain: Math.round(r.gain * 10) / 10,
            option: Math.round(r.option * 10) / 10,
            best_plan_edge: Math.round((r.bestPlan - r.overallAverage) * 10) / 10,
            graded: r.player.graded,
          })),
        },
      });
      return;
    }

    throw new Error(`unknown message: ${type}`);
  } catch (err) {
    self.postMessage({ id, ok: false, error: err.message });
  }
};
