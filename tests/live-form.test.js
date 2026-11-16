import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateLive, planArtistChanges } from '../src/core/live-form.js';

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

const ex = [
  { id: 'a', name: 'A', position: 0 },
  { id: 'b', name: 'B', position: 1 },
  { id: 'c', name: 'C', position: 2 },
];

test('planArtistChanges：変更なしなら位置も名前も同じ update だけ', () => {
  const r = planArtistChanges(ex, ex.map(({ id, name }) => ({ id, name })));
  assert.deepEqual(r.deletes, []);
  assert.deepEqual(r.inserts, []);
  assert.equal(r.updates.length, 3);
});

test('planArtistChanges：名前だけ変える → update 1件、delete 0件（id を保つ）', () => {
  const r = planArtistChanges(ex, [{ id: 'a', name: 'A' }, { id: 'b', name: ' B2 ' }, { id: 'c', name: 'C' }]);
  assert.deepEqual(r.updates.find((u) => u.id === 'b'), { id: 'b', name: 'B2', position: 1 });
  assert.deepEqual(r.deletes, []);
  assert.deepEqual(r.inserts, []);
});

test('planArtistChanges：並べ替え → 新しい position の update、delete なし', () => {
  const r = planArtistChanges(ex, [{ id: 'c', name: 'C' }, { id: 'a', name: 'A' }, { id: 'b', name: 'B' }]);
  assert.deepEqual(r.updates, [
    { id: 'c', name: 'C', position: 0 },
    { id: 'a', name: 'A', position: 1 },
    { id: 'b', name: 'B', position: 2 },
  ]);
  assert.deepEqual(r.deletes, []);
});

test('planArtistChanges：1組消す → delete 1件', () => {
  const r = planArtistChanges(ex, [{ id: 'a', name: 'A' }, { id: 'c', name: 'C' }]);
  assert.deepEqual(r.deletes, ['b']);
  assert.deepEqual(r.updates.map((u) => [u.id, u.position]), [['a', 0], ['c', 1]]);
  assert.deepEqual(r.inserts, []);
});

test('planArtistChanges：1組足す → insert 1件（id なし）', () => {
  const r = planArtistChanges(ex, [...ex.map(({ id, name }) => ({ id, name })), { name: ' D ' }]);
  assert.deepEqual(r.inserts, [{ name: 'D', position: 3 }]);
  assert.deepEqual(r.deletes, []);
});

test('planArtistChanges：混在（空の名前は捨て、知らない id は insert）', () => {
  const r = planArtistChanges(ex, [
    { id: 'c', name: 'C' },
    { name: '   ' },
    { id: 'zzz', name: 'Z' },
    { name: 'N' },
    { id: 'a', name: 'A2' },
  ]);
  assert.deepEqual(r.updates, [
    { id: 'c', name: 'C', position: 0 },
    { id: 'a', name: 'A2', position: 3 },
  ]);
  assert.deepEqual(r.deletes, ['b']);
  assert.deepEqual(r.inserts, [
    { name: 'Z', position: 1 },
    { name: 'N', position: 2 },
  ]);
});
