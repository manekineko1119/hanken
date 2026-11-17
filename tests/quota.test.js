import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ptDay, jstDay, estimateSaveUnits, canSpend, LIMITS } from '../supabase/functions/_shared/quota.js';

test('ptDay: 冬時間（UTC-8）の境目', () => {
  assert.equal(ptDay(new Date('2026-11-17T07:59:00Z')), '2026-11-16');
  assert.equal(ptDay(new Date('2026-11-17T08:00:00Z')), '2026-11-17');
});

test('ptDay: 夏時間（UTC-7）の境目', () => {
  assert.equal(ptDay(new Date('2026-07-01T06:59:00Z')), '2026-06-30');
  assert.equal(ptDay(new Date('2026-07-01T07:00:00Z')), '2026-07-01');
});

test('jstDay: 日本時間の日付', () => {
  assert.equal(jstDay(new Date('2026-11-16T14:59:00Z')), '2026-11-16');
  assert.equal(jstDay(new Date('2026-11-16T15:00:00Z')), '2026-11-17');
});

test('estimateSaveUnits', () => {
  assert.equal(estimateSaveUnits({ existingItems: 0, count: 10, isNew: true }), 550);
  assert.equal(estimateSaveUnits({ existingItems: 8, count: 10, isNew: false }), 50 * 8 + 50 * 10 + 1);
});

test('canSpend', () => {
  assert.equal(canSpend(9000, 550), false);
  assert.equal(canSpend(9000, 500), true);
  assert.equal(canSpend(9000, 501), false);
  assert.equal(canSpend(100, 200, 250), false);
  assert.equal(canSpend(100, 150, 250), true);
});

test('LIMITS', () => {
  assert.deepEqual(LIMITS, { save: 5, search: 30, setlist: 20, globalSearch: 90 });
});
