import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pool, slots, teams, rounds } from './fixture.js';
import { situation, board } from '../js/value.js';

test('app worker matches the shared model across draft updates and league resets', async () => {
  // Run the actual worker handler with structured-cloned messages, without
  // browser globals leaking into the model or requiring network fixtures.
  const responses = [];
  globalThis.self = { postMessage: message => responses.push(structuredClone(message)) };
  try {
    await import('../js/worker.js');
    let id = 0;
    const ask = (type, payload) => {
      const requestId = ++id;
      self.onmessage({ data: structuredClone({ id: requestId, type, payload }) });
      const response = responses.pop();
      assert.equal(response.id, requestId);
      return response;
    };
    assert.match(ask('price', {}).error, /before the pool/);
    for (const type of ['snake', 'linear']) {
      const input = { pool: pool(), slots, userIds: ['us'],
        draft: { teams, rounds, type, reversal_round: 0, draft_order: { us: 8 } } };
      assert.equal(ask('init', input).result.players, input.pool.length);
      for (const count of [0, 48, 144]) {
        const gone = input.pool.slice(0, count).map(p => p.player_id);
        const ours = gone.filter((_, i) => i % teams === 7);
        const payload = { gone, ours, atPick: count + 1 };
        const actual = ask('price', payload);
        assert.equal(actual.ok, true, actual.error);
        const sit = situation({ ...structuredClone(input), gone: new Set(gone),
          ours: new Set(ours), userIds: new Set(input.userIds), atPick: payload.atPick });
        const expected = board(sit);
        const round = value => Math.round(value * 10) / 10;
        assert.deepEqual(actual.result, {
          atPick: payload.atPick, upcoming: expected.upcoming,
          roster: sit.roster.map(p => p.player_id),
          values: expected.ranked.map(r => ({ player_id: r.player.player_id,
            value: round(r.value), gain: round(r.gain), option: round(r.option),
            best_plan_edge: round(r.bestPlan - r.overallAverage), graded: r.player.graded })),
        });
        assert.ok(actual.result.values.every(r => Number.isFinite(r.value) && Number.isFinite(r.gain)));
      }
    }
    assert.match(ask('unknown', {}).error, /unknown message/);
  } finally {
    delete globalThis.self;
  }
});
