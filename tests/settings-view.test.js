import { test } from 'node:test';
import assert from 'node:assert/strict';
import { daysLeft } from '../src/core/youtube.js';

const base = '2026-11-10T00:00:00Z';
const after = (d) => new Date(Date.parse(base) + d * 86400000);

test('daysLeft：つないで2日後は5', () => assert.equal(daysLeft(base, after(2)), 5));
test('daysLeft：つないだ直後は7', () => assert.equal(daysLeft(base, after(0)), 7));
test('daysLeft：8日後は0（負にならない）', () => assert.equal(daysLeft(base, after(8)), 0));
test('daysLeft：ちょうど7日後は0', () => assert.equal(daysLeft(base, after(7)), 0));
test('daysLeft：半日過ぎたら切り上げて残りを数える', () => assert.equal(daysLeft(base, after(2.5)), 5));
test('daysLeft：日時が読めないときは0', () => assert.equal(daysLeft('x', after(1)), 0));

test('pendingIdOf：yt=finish と p があれば p を返す。なければ null', async () => {
  const { pendingIdOf } = await import('../src/core/youtube.js');
  assert.equal(pendingIdOf({ yt: 'finish', p: 'abc' }), 'abc');
  assert.equal(pendingIdOf({ yt: 'finish' }), null);
  assert.equal(pendingIdOf({ yt: 'error', p: 'abc' }), null);
  assert.equal(pendingIdOf(undefined), null);
});

test('finishErrorText：ほかのアカウント・時間切れ・そのほか', async () => {
  const { finishErrorText } = await import('../src/core/youtube.js');
  assert.match(finishErrorText('WRONG_USER'), /ほかのアカウント/);
  assert.match(finishErrorText('EXPIRED'), /時間が切れ/);
  assert.match(finishErrorText(undefined), /つなげませんでした/);
});

test('cleanHomeStation：前後の空白（全角も）を取る。「駅」は触らない', async () => {
  const { cleanHomeStation } = await import('../src/core/settings.js');
  assert.equal(cleanHomeStation('  渋谷駅 '), '渋谷駅');
  assert.equal(cleanHomeStation('　新宿　'), '新宿');
  assert.equal(cleanHomeStation('池袋'), '池袋');
  assert.equal(cleanHomeStation('大 宮'), '大 宮');
});

test('cleanHomeStation：空・空白だけ・文字列以外は null', async () => {
  const { cleanHomeStation } = await import('../src/core/settings.js');
  for (const v of ['', '   ', '　 　', null, undefined, 5]) assert.equal(cleanHomeStation(v), null);
});
