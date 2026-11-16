import { test } from 'node:test';
import assert from 'node:assert/strict';
import { todayJst, splitLives, formatDateJa, liveHeading } from '../src/core/lives.js';
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

test('formatDateJa：YYYY/MM/DD と曜日', () => {
  assert.equal(formatDateJa('2026-12-01'), '2026/12/01（火）');
  assert.equal(formatDateJa('2026-11-15'), '2026/11/15（日）');
  assert.equal(formatDateJa('2027-01-01'), '2027/01/01（金）');
});

test('formatDateJa：うるう日と不正な値', () => {
  assert.equal(formatDateJa('2028-02-29'), '2028/02/29（火）');
  assert.equal(formatDateJa(''), '');
  assert.equal(formatDateJa(null), '');
  assert.equal(formatDateJa('abc'), 'abc');
});

test('liveHeading：タイトルがあればそれ（前後の空白は除く）', () => {
  assert.equal(liveHeading({ title: '  春の対バン ', date: '2026-12-01', artists: [{ name: 'A', position: 0 }] }), '春の対バン');
});

test('liveHeading：タイトルがなければ出演者を position 順に「、」でつなぐ', () => {
  const live = { title: null, date: '2026-12-01', artists: [{ name: 'B', position: 1 }, { name: 'A', position: 0 }] };
  assert.equal(liveHeading(live), 'A、B');
  assert.equal(liveHeading({ ...live, title: '   ' }), 'A、B');
});

test('liveHeading：どちらもなければ日付', () => {
  assert.equal(liveHeading({ title: null, date: '2026-12-01', artists: [] }), '2026/12/01（火）');
  assert.equal(liveHeading({ date: '2026-12-01' }), '2026/12/01（火）');
});
