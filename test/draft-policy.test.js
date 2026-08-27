import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scriptedChoice, missingStarters } from '../js/draft-policy.js';

const player = (position, adp, id = position) => ({ position, adp, player_id: id });
const slots = ['QB', 'RB', 'WR', 'TE', 'FLEX', 'K', 'DEF', 'BN', 'BN', 'BN'];

test('scripted ADP fills a needed starter before a similarly priced backup QB', () => {
  const qb = player('QB', 70), te = player('TE', 75);
  const held = [player('QB', 1), player('RB', 2), player('WR', 3)];
  assert.equal(scriptedChoice([qb, te], held, slots, { round: 7 }), te);
});

test('a large ADP bargain can override the late-QB script', () => {
  const qb = player('QB', 1), rb = player('RB', 150);
  assert.equal(scriptedChoice([qb, rb], [], slots, { round: 3, style: 'late_qb' }), qb);
});

test('K and DEF usually wait until late and are not duplicated', () => {
  const k = player('K', 20), rb = player('RB', 25);
  assert.equal(scriptedChoice([k, rb], [], slots, { round: 3 }), rb);
  assert.equal(scriptedChoice([k, rb], [player('K', 1)], slots, { round: 9 }), rb);
});

test('completion constraints reserve the final pick for an unfilled FLEX', () => {
  const held = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'QB', 'QB', 'QB'].map((p, i) => player(p, i));
  assert.equal(missingStarters(held, slots), 1);
  const qb = player('QB', 1), wr = player('WR', 200);
  assert.equal(scriptedChoice([qb, wr], held, slots), wr);
});

test('seeded wiggle room is repeatable but changes close calls across seeds', () => {
  const players = [player('RB', 50, 'a'), player('RB', 51, 'b')];
  const choice = seed => scriptedChoice(players, [], slots, { seed }).player_id;
  assert.equal(choice(12), choice(12));
  assert.ok(new Set(Array.from({ length: 100 }, (_, i) => choice(i))).size > 1);
});
