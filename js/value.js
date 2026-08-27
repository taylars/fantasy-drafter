/* What each available player is worth to us, right now.
 *
 * The board sorts by ADP, which is what the rest of the league thinks. This is
 * what *we* think, and it differs for three reasons: it prices a player against
 * the lineup we already hold, against the baseline his position can actually be
 * replaced at, and against what waiting until our next pick would get us
 * instead.
 *
 * docs/value-formula.md works through why, with the numbers. The short version:
 *
 *   value = gain(player) - cost(position)
 *
 * where `gain` is what he adds to the best legal starting lineup across a whole
 * 17-week season — his projection first corrected for the context the provider
 * cannot see — and `cost` is what spending this pick on his position does to
 * the rest of the draft. So the top of the board sits at zero and everything
 * below it is regret, in points, against the best line available.
 *
 * That makes the board and the plan the same search read two ways. They used to
 * be different calculations, and duly disagreed: at pick 49 the board wanted a
 * tight end the plan had twenty points behind a running back. Ranking a single
 * pick on what a position is worth *now* flatters a thin one, because scarcity
 * gets credited without the deep positions still to fill ever being charged.
 *
 * Everything here is pure: it takes a pool of players and returns numbers, with
 * no fetching and no storage of its own. That is what lets the board run it in
 * a worker without the page freezing, and what makes it checkable against a
 * fixed set of inputs.
 */

export const SEASON_GAMES = 17;

// Positions a FLEX slot accepts.
const FLEXABLE = new Set(["RB", "WR", "TE"]);

// The only two positions that can genuinely be refilled off waivers week to
// week. It shows in the data: the gap between the last starting kicker and the
// best one left after the draft is 0 points, and for a defense it is 1 — where
// for a running back it is 102. That difference is what the baselines below
// turn on, and it decides more of the ranking than any other single number.
const STREAMABLE = new Set(["K", "DEF"]);

// Minimum bodies to carry, whatever the starting slots alone imply. An
// expected-value model averages injuries out; a season does not. You cannot
// cover a mandatory RB slot with a receiver, so depth at the positions we must
// start is not optional. This is judgment rather than measurement — without it
// the model preferred a fourth receiver to a third back by 4.1 points, so it
// was nearly indifferent and the floor buys the insurance cheaply.
const DEPTH = { RB: 3, WR: 3, QB: 1, TE: 1, K: 1, DEF: 1 };

// How far a -2..+2 context grade moves a projection. Deliberately small: we are
// correcting a provider's number, not replacing it with our own. A maximum
// +2/+2 context stack moves the provider projection by 9%. Larger weights let
// contextual judgment overwhelm meaningful projection gaps.
const OFFENSE_WEIGHT = 0.025;
const SECURITY_WEIGHT = 0.02;

// How much of a player's season an ungraded starter is assumed to be available
// for. Only used as a fallback — a graded player uses his own exp_games, which
// is the whole point of grading.
export const DEFAULT_AVAILABILITY = { QB: 0.88, RB: 0.79, WR: 0.85, TE: 0.82, K: 0.97, DEF: 1.0 };

// Room above the projection. This is a correction to the mean, not a premium
// for variance: the three things that earn the grade — a second-year jump the
// provider smooths out, a path to work behind a fragile starter, a touchdown
// role a yardage model understates — are all reasons the projected number is
// too low, and a mixture over a role that might open has a higher mean too.
//
// So it is flat. It used to scale with the round, on the theory that a late
// pick is a lottery ticket and only the tail is worth buying; but a projection
// that is 3.5% light is 3.5% light in the first round as well.
const UPSIDE_WEIGHT = 0.0175;

// A small share of projected production above the wire gives useful bench
// players option value even when they do not improve the current lineup.
// Upside grades already affect adjusted(); a separate flat grade bonus can
// dominate late picks even for players with no above-wire projection.
const BENCH_OPTION_WEIGHT = 0.02;

// ADP is a mean and players go in a range around it. Sleeper publishes no
// spread, so this is assumed, and it is the least evidenced number in the file:
// it drives every `wait`. Measuring it from repeated mock drafts would be
// strictly better than guessing.
const ADP_SPREAD = 0.15;
const ADP_SPREAD_FLOOR = 4.0;

// How many of our upcoming picks to plan over, and the positions worth planning
// with. Four picks is often only two turns — a snake turn is frequently two
// back-to-back picks — and the prior art is clear that looking deeper than that
// buys almost nothing. K and DEF are flat enough to be selected later, but they
// still need to be part of the plan: excluding them lets a first-pick K/DEF
// claim its gain without ever spending a later pick on one.
export const PLAN_AHEAD = 4;
const PLAN_POSITIONS = ["RB", "WR", "TE", "QB", "K", "DEF"];

// How many candidates, by ADP, the board prices. Exported because every caller
// that ranks a real draft — the page, the CLI, the backtest — has to use the
// same number or they are not measuring the same board. They drifted once:
// the backtest planned two picks ahead against the whole pool while the page
// planned four against the top 250, and the backtest's grade was reporting a
// strategy nothing in production ran.
export const BOARD_LIMIT = 250;

/* Season points if he played every week, corrected for context.
 *
 * Deliberately *not* scaled by availability. The games he misses are priced
 * once, in `coverage`, where they fall through to whoever is next at his
 * position — scaling here as well would charge for them twice.
 *
 * `upside` belongs here rather than as a bonus on the board because it says the
 * same kind of thing the other two do: this projection is wrong, by about this
 * much. Putting it here also gets the guard the bonus needed by hand — a backup
 * quarterback's breakout is worth nothing to us — for free, since the lineup
 * never plays him.
 */
export function adjusted(player) {
  if (player._adjusted === undefined) {
    player._adjusted = player.points * (
      1 + OFFENSE_WEIGHT * player.offense
        + SECURITY_WEIGHT * player.position_security
        + UPSIDE_WEIGHT * player.upside);
  }
  return player._adjusted;
}

/* What an unfilled slot at each position is really worth.
 *
 * Streamable positions get the last starter, because a top-12 kicker is always
 * a waiver claim away. Everything else gets the best player left once the draft
 * is over, which is what the wire actually offers — for a running back that is
 * a hundred points worse than the last starter, and assuming otherwise makes a
 * receiver-only draft look optimal when it isn't.
 *
 * The last starter looks too generous for a streamable position, and the board
 * duly takes a kicker in round 10 where ADP waits until 12. It credits the best
 * kicker +22.3 and the best defense +13.0 from an empty roster, which is a lot
 * for a pick that could be a fourth receiver. That was measured rather than
 * argued: the streamable rung was swept from the last starter up to the best
 * player at the position — the level that collapses the surplus to zero and
 * leaves `mustFill` alone to decide — over seeds 1-8, paired seat for seat.
 *
 *   rung, as a share of        K round  DEF round   points vs
 *   last starter -> best                             the last starter
 *   0%  (the last starter)        9.6      10.7      —  (1896.4 ±9.5)
 *   40%                          10.0      11.1       -1.4 ±1.2
 *   70%                          10.6      11.6      -32.0 ±3.5
 *   85%                          11.8      12.8      -46.8 ±3.8
 *   100% (the best kicker)       14.0      15.0      -20.2 ±3.9
 *
 * Every rung loses, and pushing the other way — below the last starter, taking
 * K and DEF earlier still — also loses (-2.0 ±0.8). This is a peak, not a slope.
 *
 * The reason is that the freed picks buy nothing. At the -32 rung the roster mix
 * moves by under a tenth of a player everywhere and the entire loss is K and DEF
 * scoring less; at the -20 rung the picks go into a second and third quarterback
 * (QB 1.00 -> 2.63 per roster) worth less than the depth back they displace.
 * There is no round-10 receiver waiting to be freed. Kicker alone, delayed to
 * round 12, costs -60.1 ±4.2.
 *
 * Read this as one season, though. The 2025 projections rank kickers at
 * Spearman 0.29 over a 17-man pool and defenses at 0.29 over 26 — weak enough
 * that the true correlation could be near zero, and the board's kicker edge
 * (176.6 against ADP's 134.0) leans on the projection having correctly put the
 * season's best kicker first. The rung is right for this data; it is the number
 * here most likely to be luck, and a second season should re-run this sweep.
 */
export function baselines(pool, teams, rounds) {
  const drafted = teams * rounds;
  const out = {};
  const byPosition = new Map();
  for (const player of pool) {
    if (!byPosition.has(player.position)) byPosition.set(player.position, []);
    byPosition.get(player.position).push(player);
  }

  for (const [position, players] of byPosition) {
    const ranked = players.map(adjusted).sort((a, b) => b - a);
    if (!ranked.length) continue;
    if (STREAMABLE.has(position)) {
      out[position] = ranked[Math.min(teams, ranked.length) - 1];
    } else {
      const taken = players.filter((p) => p.adp <= drafted).length;
      out[position] = ranked[Math.min(taken, ranked.length - 1)];
    }
  }
  return out;
}

/* Slot-seasons each position owes, and the FLEX seasons anyone can cover.
 *
 * The FLEX is deliberately *not* handed to a position here. Doing that made an
 * unfilled slot collect whichever baseline was highest — a free waiver tight
 * end, in one league — which is worth more than a real receiver, so every
 * receiver on the board priced at exactly 0.0. A FLEX is one slot that several
 * positions can fill, so it is carried as its own demand and settled in
 * `coverage` against whoever is actually spare.
 */
function slotDemand(slots) {
  const need = {};
  for (const slot of slots) {
    if (slot === "BN" || slot === "FLEX") continue;
    need[slot] = (need[slot] ?? 0) + 1;
  }
  for (const [position, floor] of Object.entries(DEPTH)) {
    if (position in need) {
      need[position] = Math.max(need[position], floor * (DEFAULT_AVAILABILITY[position] ?? 0.85));
    }
  }
  return { need, flex: slots.filter((s) => s === "FLEX").length };
}

/* What an unfilled FLEX is worth: the best of the positions it accepts.
 *
 * An empty FLEX is not empty in practice — we stream the best flexable player
 * on the wire into it. That is a genuinely higher floor than any single
 * position's, which is exactly why the slot must not be allowed to compete with
 * our own players for the spot.
 */
function wire(base) {
  let best = 0;
  for (const position of FLEXABLE) {
    if (position in base && base[position] > best) best = base[position];
  }
  return best;
}

/* Season points this roster covers against a given demand.
 *
 * A player covers only the share of the season he is available for, so the
 * games his starters miss fall to the next man at that position, and to the
 * waiver wire if there isn't one.
 *
 * Positions are settled first and the FLEX last, out of whatever weeks are left
 * over. Best-first at both steps is optimal rather than merely convenient: the
 * FLEX floor is the best of the flexable baselines, so it is never below a
 * position's, and a player is therefore always worth at least as much in his
 * own slot as in the FLEX.
 *
 * No week is ever worth less than the wire. We would not start a player worse
 * than the best man available at his position, so a covered week is worth the
 * better of the two. Without that floor a sub-replacement player *displaces*
 * the waiver option and lowers the roster by taking a spot — which is how a
 * 25-point receiver came to cost 60 points, and how `gain` came to be something
 * a player could be punished for.
 */
function coverage(roster, need, flex, base) {
  let total = 0;
  const spare = []; // [adjusted, weeks] left over for the FLEX

  const positions = new Set(Object.keys(need));
  for (const player of roster) if (FLEXABLE.has(player.position)) positions.add(player.position);

  for (const position of positions) {
    const floor = base[position] ?? 0;
    let remaining = need[position] ?? 0;
    const mine = roster.filter((p) => p.position === position)
                       .sort((a, b) => adjusted(b) - adjusted(a));
    for (const player of mine) {
      const covered = Math.min(player.availability, remaining);
      total += covered * Math.max(adjusted(player), floor);
      remaining -= covered;
      if (player.availability > covered && FLEXABLE.has(position)) {
        spare.push([adjusted(player), player.availability - covered]);
      }
    }
    total += remaining * floor;
  }

  const floor = wire(base);
  let remaining = flex;
  spare.sort((a, b) => b[0] - a[0] || b[1] - a[1]);
  for (const [value, weeks] of spare) {
    const covered = Math.min(weeks, remaining);
    total += covered * Math.max(value, floor);
    remaining -= covered;
  }
  return total + remaining * floor;
}

/* Season points from the best legal lineup this roster can field.
 *
 * Every starting slot needs all seventeen weeks, and depth is what covers the
 * ones a starter misses — a third running back is not a spare, he is the man
 * who plays the games the first two are out for.
 */
export function lineup(roster, slots, base) {
  const { need, flex } = slotDemand(slots);
  return coverage(roster, need, flex, base);
}

/* What this player adds to the lineup we already hold.
 *
 * Never negative: a player we can leave on the bench cannot make the roster
 * worse, so noise around a zero-value pick should not read as a reason to
 * avoid him.
 */
export function gain(player, roster, slots, base, held = null) {
  const without = held ?? lineup(roster, slots, base);
  return Math.max(0, lineup([...roster, player], slots, base) - without);
}

/* Whether the roster can fill every non-bench slot at once. */
function lineupFilled(roster, slots) {
  const have = {};
  for (const player of roster) have[player.position] = (have[player.position] ?? 0) + 1;
  const exact = {};
  for (const slot of slots) {
    if (slot === "BN" || slot === "FLEX") continue;
    exact[slot] = (exact[slot] ?? 0) + 1;
  }
  for (const [position, count] of Object.entries(exact)) {
    if ((have[position] ?? 0) < count) return false;
  }
  let flexLeft = 0;
  for (const position of FLEXABLE) flexLeft += Math.max(0, (have[position] ?? 0) - (exact[position] ?? 0));
  return flexLeft >= slots.filter((s) => s === "FLEX").length;
}

/* Small, asymmetric value for a useful bench player's favorable tail.
 *
 * The downside of a bench pick is a drop; the upside is that his role grows
 * enough to matter. It applies only to an RB/WR/TE selected after the current
 * roster can already field its full starting lineup. QB, K, and DEF never
 * receive it.
 */
export function optionValue(player, roster, slots, base, filled = null) {
  const isFilled = filled ?? lineupFilled(roster, slots);
  if (!FLEXABLE.has(player.position) || !isFilled) return 0;
  return BENCH_OPTION_WEIGHT * Math.max(0, adjusted(player) - (base[player.position] ?? 0));
}

/* Value added by a draft pick: lineup production plus bench option. */
function draftGain(player, roster, slots, base, held, filled) {
  return gain(player, roster, slots, base, held) + optionValue(player, roster, slots, base, filled);
}

/* The complementary error function, which JS does not ship.
 *
 * Numerical Recipes' rational approximation, accurate to ~1.2e-7 across the
 * whole range — several orders of magnitude finer than the ADP spread it is
 * fed, which is a guess to begin with.
 */
function erfc(x) {
  const z = Math.abs(x);
  const t = 2 / (2 + z);
  const y = t - 0.5;
  const poly = -1.26551223 + y * 0 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 +
    t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 +
    t * (-0.82215223 + t * 0.17087277))))))));
  const ans = t * Math.exp(-z * z + poly);
  return x >= 0 ? ans : 2 - ans;
}

/* Rough chance a player is still on the board at `pick`.
 *
 * A smooth function of how far past his ADP the pick is, not a cutoff: ADP is a
 * mean, and the spread around it is what decides whether waiting is a real
 * option or a bet. See ADP_SPREAD — this is the assumed part of the model.
 */
export function survival(adp, pick) {
  if (adp == null || adp >= 999) return 1;
  const sigma = Math.max(ADP_SPREAD_FLOOR, ADP_SPREAD * adp);
  return 0.5 * erfc((pick - adp) / sigma / Math.SQRT2);
}

// How deep into a position the wait search looks.
const WAIT_DEPTH = 40;

/* Players at one position, best-first by what they'd add to this roster. */
function rankedAt(position, pool, roster, slots, base, held, filled) {
  const scored = [];
  for (const player of pool) {
    if (player.position !== position) continue;
    scored.push([draftGain(player, roster, slots, base, held, filled), player]);
  }
  scored.sort((a, b) => b[0] - a[0]);
  return scored.slice(0, WAIT_DEPTH);
}

/* Expected gain from the best player at `position` still there at `pick`.
 *
 * Walks the position best-first: each player contributes his gain weighted by
 * the chance he lasts, times the chance everyone better than him did not. Also
 * returns the player we'd most likely end up with, which is what makes the plan
 * search able to carry a roster forward.
 */
export function wait(position, pool, pick, roster, slots, base, held, filled) {
  const ranked = rankedAt(position, pool, roster, slots, base, held, filled);
  let expected = 0, stillGone = 1, best = 0, likely = null;
  for (const [value, player] of ranked) {
    const chance = survival(player.adp, pick);
    // The chance this is the one we actually end up with: he lasts, and nobody
    // better did. That is also what makes him the right player to carry forward
    // into a plan — the best player at the position is not, since by definition
    // he is the least likely to still be there.
    const mine = stillGone * chance;
    expected += mine * value;
    if (mine > best) { best = mine; likely = player; }
    stillGone *= 1 - chance;
  }
  return [expected, likely ?? (ranked.length ? ranked[0][1] : null)];
}

// An outcome contributing less than this to the expectation is not a thing that
// happens; the leftover probability means no worthwhile player is available.
const MIN_CONTRIBUTION = 0.05;

/* The probable player outcomes for waiting on a position. */
function waitOutcomes(position, pool, pick, roster, slots, base, held, filled) {
  const ranked = rankedAt(position, pool, roster, slots, base, held, filled);
  let stillGone = 1;
  const outcomes = [];
  for (const [value, player] of ranked) {
    const chance = survival(player.adp, pick);
    const mine = stillGone * chance;
    if (mine * value >= MIN_CONTRIBUTION) outcomes.push([mine, value, player]);
    stillGone *= 1 - chance;
  }
  const residual = Math.max(0, 1 - outcomes.reduce((sum, o) => sum + o[0], 0));
  if (residual) outcomes.push([residual, 0, null]);
  return outcomes;
}

/* Draw one deterministic, probability-weighted outcome for a plan path.
 *
 * Deterministic so that two runs of the same board agree. The generator is the
 * classic linear congruential one, used here as a hash of the path rather than
 * as a stream — each path must draw independently of the order paths are
 * walked in.
 */
function sampleOutcome(outcomes, seed) {
  const unit = ((seed * 1103515245 + 12345) & 0x7fffffff) / 0x80000000;
  let running = 0;
  for (const [probability, value, player] of outcomes) {
    running += probability;
    if (unit <= running) return [value, player];
  }
  const last = outcomes[outcomes.length - 1];
  return [last[1], last[2]];
}

/* Every pick number we own, in order.
 *
 * Derived from the draft's own order rather than written down: the slot plus
 * teams, rounds and type is enough. A draft whose order isn't set yet has no
 * answer, so it returns nothing rather than guessing.
 */
export function ourPicks(draft, userIds) {
  if (!draft.draft_order) return [];
  let slot = null;
  for (const [userId, s] of Object.entries(draft.draft_order)) {
    if (userIds.has(userId)) { slot = s; break; }
  }
  if (slot == null) return [];

  const { teams, rounds } = draft;
  const reversal = draft.reversal_round ?? 0;
  const picks = [];
  for (let round = 1; round <= rounds; round++) {
    let forward = round % 2 === 1;
    if (reversal && round >= reversal) forward = !forward;
    if (draft.type === "linear") forward = true;
    picks.push((round - 1) * teams + (forward ? slot : teams - slot + 1));
  }
  return picks;
}

/* Positions we have to spend our last picks on to field a legal lineup.
 *
 * Legality, not value. A kicker is worth ~0 to take at any point — the twelfth
 * best projects within a few points of the first, so `wait` correctly says
 * there is never a reason to hurry. Left alone that logic never takes one at
 * all, and a roster with no kicker cannot field a lineup no matter how good the
 * rest of it is. So once the picks remaining are down to the slots still empty,
 * those slots are the only thing on the board.
 */
export function mustFill(roster, slots, picksLeft) {
  const needed = {};
  for (const slot of slots) {
    if (slot === "BN" || slot === "FLEX") continue;
    needed[slot] = (needed[slot] ?? 0) + 1;
  }
  const have = {};
  for (const player of roster) have[player.position] = (have[player.position] ?? 0) + 1;

  const short = {};
  let total = 0;
  for (const [position, count] of Object.entries(needed)) {
    const gap = count - (have[position] ?? 0);
    if (gap > 0) { short[position] = gap; total += gap; }
  }
  return picksLeft <= total ? new Set(Object.keys(short)) : new Set();
}

/* Positions that can still add a player to the draft plan.
 *
 * K and DEF are single-purpose roster slots, not depth positions. Once all of a
 * league's slots at either position are filled, a later pick there is a
 * replacement rather than useful roster construction. The lineup model can
 * assign that replacement a tiny positive gain, but the planner should not
 * spend a second roster spot chasing it.
 */
export function planPositions(roster, slots, positions = PLAN_POSITIONS) {
  const have = {};
  for (const player of roster) have[player.position] = (have[player.position] ?? 0) + 1;
  const needed = {};
  for (const slot of slots) if (STREAMABLE.has(slot)) needed[slot] = (needed[slot] ?? 0) + 1;
  return positions.filter((p) => !STREAMABLE.has(p) || (have[p] ?? 0) < (needed[p] ?? 0));
}

/* Mean and best value of every modeled continuation.
 *
 * Each position choice is one branch. Within it, the player is drawn from the
 * probability-weighted outcomes at that position. Every position path gets its
 * own deterministic draw, so the mean combines likely players over all modeled
 * plans without making the live board enumerate an intractable
 * player-by-player tree.
 */
function continuationStats(picks, roster, available, slots, base, positions, sampleKey) {
  if (!picks.length) return [0, 0];

  const held = lineup(roster, slots, base);
  const filled = lineupFilled(roster, slots);
  const meanTotals = [], bestTotals = [];

  planPositions(roster, slots, positions).forEach((position, index) => {
    const outcomes = waitOutcomes(position, available, picks[0], roster, slots, base, held, filled);
    if (!outcomes.length) return;
    const [got, player] = sampleOutcome(outcomes, sampleKey * 7 + index);

    const [meanRest, bestRest] = player === null
      ? continuationStats(picks.slice(1), roster, available, slots, base, positions,
                          sampleKey * 7 + index)
      : continuationStats(picks.slice(1), [...roster, player],
                          available.filter((p) => p.player_id !== player.player_id),
                          slots, base, positions, sampleKey * 7 + index);

    meanTotals.push(got + meanRest);
    bestTotals.push(got + bestRest);
  });

  if (!meanTotals.length) return [0, 0];
  return [meanTotals.reduce((a, b) => a + b, 0) / meanTotals.length, Math.max(...bestTotals)];
}

/* Best total gain over `picks`, and who we'd expect to end up with.
 *
 * Recursive rather than an enumeration of whole sequences, so every prefix is
 * priced once instead of once per sequence that starts with it — the same 256
 * plans for a third of the work.
 *
 * The roster grows as it goes, which is the entire point: a plan that scores
 * each pick against the roster we hold today is not a plan, because by the
 * third pick it is pricing against a roster we won't have.
 */
function continuation(picks, roster, available, slots, base, positions) {
  if (!picks.length) return [0, []];

  const held = lineup(roster, slots, base);
  const filled = lineupFilled(roster, slots);
  let best = null;

  for (const position of planPositions(roster, slots, positions)) {
    const [got, player] = wait(position, available, picks[0], roster, slots, base, held, filled);
    if (player === null) continue;
    const [rest, taken] = continuation(
      picks.slice(1), [...roster, player],
      available.filter((p) => p.player_id !== player.player_id),
      slots, base, positions);
    const total = got + rest;
    if (best === null || total > best[0]) best = [total, [[picks[0], player], ...taken]];
  }
  return best ?? [0, []];
}

/* The draft as it stands, and everything pricing a pick needs.
 *
 * Shared so the board and the plan can't drift: they used to build this
 * separately, which is exactly how they came to disagree about tight ends.
 */
export function situation({ pool, slots, draft, gone, ours, atPick, userIds }) {
  return {
    slots,
    base: baselines(pool, draft.teams, draft.rounds),
    roster: pool.filter((p) => ours.has(p.player_id)),
    available: pool.filter((p) => !gone.has(p.player_id)),
    upcoming: ourPicks(draft, userIds).filter((p) => p >= atPick),
    atPick,
    round: draft.teams ? Math.ceil(atPick / draft.teams) : 1,
  };
}

/* Mean continuations after spending this pick on each position.
 *
 * Returns each position's mean continuation, the grand mean across all modeled
 * first-position plans, and the best-plan total for tooltip context. The board
 * adds a player's direct gain to its continuation, then subtracts that grand
 * mean. This is the one score used to rank and recommend picks.
 */
function outlook(sit, candidates, gains, ahead) {
  const picks = sit.upcoming.slice(0, ahead);
  const restOf = {}, bestPlan = {}, startingAverages = [];
  const open = new Set(planPositions(sit.roster, sit.slots));

  const positions = new Set();
  for (const player of candidates) if (open.has(player.position)) positions.add(player.position);

  for (const position of positions) {
    // The player the board would take, which is simply the best gain now that
    // upside is inside it rather than added on afterwards.
    let got = -Infinity, chosen = null;
    for (const player of candidates) {
      if (player.position !== position) continue;
      if (gains[player.player_id] > got) { got = gains[player.player_id]; chosen = player; }
    }
    const [mean, bestRest] = continuationStats(
      picks.slice(1), [...sit.roster, chosen],
      sit.available.filter((p) => p.player_id !== chosen.player_id),
      sit.slots, sit.base, PLAN_POSITIONS, 1);
    restOf[position] = mean;
    startingAverages.push(got + mean);
    bestPlan[position] = got + bestRest;
  }

  const overallAverage = startingAverages.length
    ? startingAverages.reduce((a, b) => a + b, 0) / startingAverages.length : 0;
  return { restOf, overallAverage, bestPlan };
}

/* Rank what's left by what it's worth to us at the pick we're on.
 *
 * Each row's score is its mean modeled team value over every continuation after
 * taking that player, compared with the mean of all modeled plans.
 *
 *   score(i) = gain(i) + mean_continuation(position after taking i)
 *              - mean(all plans)
 *
 * `plans` remains a separate, best-case path explorer. It is useful to explain
 * upside, but it does not participate in the recommendation score.
 */
export function board(sit, { limit = BOARD_LIMIT, ahead = PLAN_AHEAD } = {}) {
  const forced = mustFill(sit.roster, sit.slots, sit.upcoming.length);
  const open = new Set(planPositions(sit.roster, sit.slots));
  const pickable = sit.available.filter((p) => forced.size ? forced.has(p.position) : open.has(p.position));
  const candidates = pickable.slice().sort((a, b) => a.adp - b.adp).slice(0, limit);

  // The roster is the same for every candidate, so its lineup and whether it is
  // already filled are computed once rather than once per player.
  const held = lineup(sit.roster, sit.slots, sit.base);
  const filled = lineupFilled(sit.roster, sit.slots);

  const lineupGains = {}, options = {}, gains = {};
  for (const player of candidates) {
    lineupGains[player.player_id] = gain(player, sit.roster, sit.slots, sit.base, held);
    options[player.player_id] = optionValue(player, sit.roster, sit.slots, sit.base, filled);
    gains[player.player_id] = lineupGains[player.player_id] + options[player.player_id];
  }

  const { restOf, overallAverage, bestPlan } = outlook(sit, candidates, gains, ahead);

  const ranked = candidates.map((player) => {
    const got = gains[player.player_id];
    const value = got + restOf[player.position] - overallAverage;
    return {
      player,
      value,
      gain: lineupGains[player.player_id],
      option: options[player.player_id],
      cost: -value,
      overallAverage,
      bestPlan: bestPlan[player.position],
    };
  });
  // Ties are common and not rare noise: below the starters a whole block of
  // players can price identically, and which of them the board shows first
  // must not depend on the order the pool happened to arrive in. ADP breaks
  // them — of two players worth the same, the one the room rates higher is the
  // one that will be gone first — and the name settles the rest so that two
  // runs of the same board agree.
  ranked.sort((a, b) => b.value - a.value
                     || a.player.adp - b.player.adp
                     || a.player.name.localeCompare(b.player.name));
  return { ranked, roster: sit.roster, upcoming: sit.upcoming };
}

/* The best plan starting with each position, best first.
 *
 * This is what answers "take a back now, or wait a round?" — and it is the same
 * search `board` ranks on, so the two cannot disagree. What it adds is the
 * reasoning: which players it expects to get, and in what order.
 */
export function plans(sit, { ahead = PLAN_AHEAD, positions = PLAN_POSITIONS } = {}) {
  const picks = sit.upcoming.slice(0, ahead);
  if (!picks.length) return [];

  const held = lineup(sit.roster, sit.slots, sit.base);
  const filled = lineupFilled(sit.roster, sit.slots);
  const scored = [];

  for (const position of planPositions(sit.roster, sit.slots, positions)) {
    let got = -Infinity, chosen = null;
    for (const player of sit.available) {
      if (player.position !== position) continue;
      const value = gain(player, sit.roster, sit.slots, sit.base, held)
                  + optionValue(player, sit.roster, sit.slots, sit.base, filled);
      if (value > got) { got = value; chosen = player; }
    }
    if (chosen === null) continue;

    const [rest, taken] = continuation(
      picks.slice(1), [...sit.roster, chosen],
      sit.available.filter((p) => p.player_id !== chosen.player_id),
      sit.slots, sit.base, positions);
    const plan = [[picks[0], chosen], ...taken];
    scored.push({ total: got + rest, sequence: plan.map(([, p]) => p.position), plan });
  }
  scored.sort((a, b) => b.total - a.total);
  return scored;
}
