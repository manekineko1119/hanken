import { test } from 'node:test';
import assert from 'node:assert/strict';
import { moveTrackTo, dropIndex } from '../src/core/reorder.js';

const t = (title, isLatest = false) => ({ title, isLatest });
const titles = (a) => a.map((x) => x.title);

test('moveTrackTo: 下へ・上へ動かす', () => {
  const a = [t('a'), t('b'), t('c'), t('d')];
  assert.deepEqual(titles(moveTrackTo(a, 0, 2)), ['b', 'c', 'a', 'd']);
  assert.deepEqual(titles(moveTrackTo(a, 3, 1)), ['a', 'd', 'b', 'c']);
  assert.deepEqual(titles(a), ['a', 'b', 'c', 'd']);
});

test('moveTrackTo: 同じ場所・範囲外・不正な値はそのまま（同じ配列を返す）', () => {
  const a = [t('a'), t('b')];
  assert.equal(moveTrackTo(a, 1, 1), a);
  assert.equal(moveTrackTo(a, -1, 0), a);
  assert.equal(moveTrackTo(a, 0, 5), a);
  assert.equal(moveTrackTo(a, 0.5, 1), a);
});

test('moveTrackTo: 最新の枠は動かせず、最新の枠より後ろにも置けない', () => {
  const a = [t('a'), t('b'), t('c'), t('new', true)];
  assert.equal(moveTrackTo(a, 3, 0), a);
  assert.deepEqual(titles(moveTrackTo(a, 0, 3)), ['b', 'c', 'a', 'new']);
});

test('dropIndex: ほかの行の中央を越えた数が、落とす場所', () => {
  const mids = [10, 30, 50, 70];
  assert.equal(dropIndex(mids, 0, 12), 0);
  assert.equal(dropIndex(mids, 0, 35), 1);
  assert.equal(dropIndex(mids, 0, 999), 3);
  assert.equal(dropIndex(mids, 3, -5), 0);
  assert.equal(dropIndex(mids, 3, 40), 2);
  assert.equal(dropIndex(mids, 1, 31), 1);
});

import { newestIndex, maxDropIndex, hasDragged, autoScrollDelta } from '../src/core/reorder.js';

test('newestIndex / maxDropIndex: 最新の曲の場所と、落とせる最後の場所', () => {
  assert.equal(newestIndex([t('a'), t('b', true)]), 1);
  assert.equal(newestIndex([t('a')]), -1);
  assert.equal(maxDropIndex([t('a'), t('b'), t('n', true)]), 1);
  assert.equal(maxDropIndex([t('a'), t('b')]), 1);
  assert.equal(maxDropIndex([]), -1);
});

test('hasDragged: 押しただけ・ほんの少しの揺れは「動かした」にしない', () => {
  assert.equal(hasDragged(100, 100), false);
  assert.equal(hasDragged(100, 104), false);
  assert.equal(hasDragged(100, 95), true);
  assert.equal(hasDragged(100, 105), true);
});

test('autoScrollDelta: 画面の端の近くでだけ、その向きに進む', () => {
  assert.equal(autoScrollDelta(300, 800, 64, 12), 0);
  assert.equal(autoScrollDelta(10, 800, 64, 12), -12);
  assert.equal(autoScrollDelta(790, 800, 64, 12), 12);
});
