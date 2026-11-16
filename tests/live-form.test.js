import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateLive } from '../src/core/live-form.js';

test('validateLive：日付があり出演者が1組以上なら ok', () => {
  assert.deepEqual(validateLive({ date: '2026-11-17', artists: [{ name: ' Aさん ' }] }), { ok: true, errors: {} });
});

test('validateLive：日付なしはエラー', () => {
  const r = validateLive({ date: '', artists: [{ name: 'A' }] });
  assert.equal(r.ok, false);
  assert.equal(r.errors.date, '日付を入れてください');
  assert.equal(r.errors.artists, undefined);
});

test('validateLive：出演者0組、空白だけの名前はエラー', () => {
  for (const artists of [[], [{ name: '' }], [{ name: '   ' }], undefined]) {
    const r = validateLive({ date: '2026-11-17', artists });
    assert.equal(r.ok, false);
    assert.equal(r.errors.artists, '出演者を1組以上入れてください');
  }
});

test('validateLive：両方ないと両方のエラー', () => {
  const r = validateLive({});
  assert.equal(r.ok, false);
  assert.deepEqual(Object.keys(r.errors).sort(), ['artists', 'date']);
});
