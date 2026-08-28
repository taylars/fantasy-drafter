/* A scripted ADP drafter, independent of the board's value formula.
 * Preferences are in draft-pick units, so a sufficiently large ADP bargain
 * can beat the script. Roster completion and the league's position limits are
 * the only hard constraints.
 */
const FLEX = new Set(['RB', 'WR', 'TE']);
export const STYLES = ['adp', 'robust_rb', 'zero_rb', 'late_qb'];

function counts(items) {
  const out = {};
  for (const item of items) out[item] = (out[item] ?? 0) + 1;
  return out;
}

export function missingStarters(roster, slots) {
  const have = counts(roster.map(p => p.position));
  const need = counts(slots.filter(s => s !== 'BN' && s !== 'FLEX'));
  const exact = Object.entries(need).reduce((n, [p, k]) => n + Math.max(0, k - (have[p] ?? 0)), 0);
  const spare = [...FLEX].reduce((n, p) => n + Math.max(0, (have[p] ?? 0) - (need[p] ?? 0)), 0);
  return exact + Math.max(0, slots.filter(s => s === 'FLEX').length - spare);
}

// Stateless seeded noise: the same manager values the same candidate the same
// way at a pick even when a counterfactual hero pick changes the available pool.
function noise(key) {
  let h = 2166136261;
  for (const c of key) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return (h >>> 0) / 4294967296;
}

export function scriptedChoice(available, roster, slots, {
  teams = 12, round = roster.length + 1, style = 'adp', seed = 1, seat = 1, limits = {},
} = {}) {
  if (!STYLES.includes(style)) throw new Error(`unknown draft style: ${style}`);
  const have = counts(roster.map(p => p.position));
  const need = counts(slots.filter(s => s !== 'BN' && s !== 'FLEX'));
  const picksLeft = slots.length - roster.length;
  const missing = missingStarters(roster, slots);
  const flexNeed = slots.filter(s => s === 'FLEX').length;
  const qbWindow = style === 'late_qb' ? 10 : 7;
  let best = null, bestScore = Infinity;

  for (const p of available) {
    const pos = p.position;
    if ((have[pos] ?? 0) >= (limits[pos] ?? Infinity)) continue;
    if (!(pos in need) && !(FLEX.has(pos) && flexNeed)) continue;
    if ((pos === 'K' || pos === 'DEF') && (have[pos] ?? 0) >= (need[pos] ?? 0)) continue;
    const after = missingStarters([...roster, p], slots);
    if (after > picksLeft - 1) continue;

    const held = have[pos] ?? 0;
    const required = need[pos] ?? 0;
    let roundsPenalty = 0;
    if (pos === 'K' || pos === 'DEF') {
      roundsPenalty += Math.max(0, slots.length - 2 - round) * 1.5;
    } else if (pos === 'QB' || pos === 'TE') {
      const window = pos === 'QB' ? qbWindow : 7;
      if (held >= required) roundsPenalty += 4 + held * 2 + missing;
      else roundsPenalty += Math.max(0, window - round) * 0.35 - Math.max(0, round - window) * 1.2;
    } else {
      // Fill required bodies before hoarding one position; allow roughly half
      // the FLEX demand and one reserve at each of RB/WR before diminishing it.
      const target = required + Math.ceil(flexNeed / 2) + 1;
      if (held < required) roundsPenalty -= Math.min(2, round * 0.25);
      if (held >= target) roundsPenalty += (held - target + 1) * 2;
      if (round <= 4 && pos === 'RB') {
        if (style === 'robust_rb' && held < 2) roundsPenalty -= 1.5;
        if (style === 'zero_rb') roundsPenalty += 3;
      }
    }
    if (round >= 8 && after < missing) roundsPenalty -= (round - 7) * 0.5;
    const jitter = (noise(`${seed}:${seat}:${round}:${p.player_id}`) - 0.5) * teams * 0.6;
    const score = p.adp + teams * roundsPenalty + jitter;
    if (score < bestScore || (score === bestScore && p.player_id < best?.player_id)) {
      best = p;
      bestScore = score;
    }
  }
  return best;
}
