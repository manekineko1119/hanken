import { test } from 'node:test';
import assert from 'node:assert/strict';
import { todayJst, splitLives } from '../src/core/lives.js';
import { pickConfig } from '../src/config.js';

test('todayJst：UTC の夜は日本では翌日', () => {
  assert.equal(todayJst(new Date('2026-11-16T15:30:00Z')), '2026-11-17');
});

test('todayJst：UTC の早朝は日本では同じ日', () => {
  assert.equal(todayJst(new Date('2026-11-17T00:30:00Z')), '2026-11-17');
  assert.equal(todayJst(new Date('2026-11-16T14:59:59Z')), '2026-11-16');
});

test('splitLives：今日のライブは upcoming、upcoming は近い順、past は新しい順', () => {
  const l = (id, date) => ({ id, date, artists: [] });
  const r = splitLives(
    [l('a', '2026-12-01'), l('b', '2026-11-17'), l('c', '2026-11-01'), l('d', '2026-10-01'), l('e', '2026-11-20')],
    '2026-11-17',
  );
  assert.deepEqual(r.upcoming.map((x) => x.id), ['b', 'e', 'a']);
  assert.deepEqual(r.past.map((x) => x.id), ['c', 'd']);
});

test('splitLives：空でも動き、入力を書き換えない', () => {
  assert.deepEqual(splitLives([], '2026-11-17'), { upcoming: [], past: [] });
  const input = [{ id: 'x', date: '2026-12-01' }, { id: 'y', date: '2026-11-18' }];
  splitLives(input, '2026-11-17');
  assert.deepEqual(input.map((x) => x.id), ['x', 'y']);
});

test('pickConfig：localhost と 127.0.0.1 はローカルの Supabase', () => {
  const local = { url: 'http://127.0.0.1:55321', key: 'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH' };
  assert.deepEqual(pickConfig('localhost'), local);
  assert.deepEqual(pickConfig('127.0.0.1'), local);
});

test('pickConfig：ほかのホストは空（本番の値はデプロイ時に入れる）', () => {
  assert.deepEqual(pickConfig('example.github.io'), { url: '', key: '' });
  assert.deepEqual(pickConfig(undefined), { url: '', key: '' });
});
