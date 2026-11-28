import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeStation, directionsUrl, nearbyUrl, lastTrainUrl } from '../src/core/live-links.js';

test('normalizeStation: 空白と末尾の駅を除く', () => {
  assert.equal(normalizeStation(' 渋谷駅 '), '渋谷');
  assert.equal(normalizeStation('\u3000新宿駅\u3000'), '新宿');
  assert.equal(normalizeStation('渋谷'), '渋谷');
  assert.equal(normalizeStation('渋谷 駅'), '渋谷');
});

test('normalizeStation: 空なら null', () => {
  assert.equal(normalizeStation(null), null);
  assert.equal(normalizeStation(''), null);
  assert.equal(normalizeStation('  \u3000 '), null);
  assert.equal(normalizeStation('駅'), null);
});

test('lastTrainUrl: 項目の順が固定の URL', () => {
  assert.equal(
    lastTrainUrl({ date: '2026-12-05', venue_station: '渋谷' }, '新宿'),
    'https://transit.yahoo.co.jp/search/result?from=%E6%B8%8B%E8%B0%B7&to=%E6%96%B0%E5%AE%BF&y=2026&m=12&d=05&hh=12&m1=0&m2=0&type=2',
  );
});

test('lastTrainUrl: 駅名の空白と「駅」を除いても同じ URL', () => {
  const expected = lastTrainUrl({ date: '2026-12-05', venue_station: '渋谷' }, '新宿');
  assert.equal(lastTrainUrl({ date: '2026-12-05', venue_station: ' 渋谷駅 ' }, '\u3000新宿駅'), expected);
});

test('lastTrainUrl: 1月1日は 2 桁', () => {
  const url = lastTrainUrl({ date: '2027-01-01', venue_station: '渋谷' }, '新宿');
  assert.match(url, /&y=2027&m=01&d=01&/);
});

test('lastTrainUrl: どちらかの駅が空なら null', () => {
  assert.equal(lastTrainUrl({ date: '2026-12-05', venue_station: '' }, '新宿'), null);
  assert.equal(lastTrainUrl({ date: '2026-12-05', venue_station: null }, '新宿'), null);
  assert.equal(lastTrainUrl({ date: '2026-12-05', venue_station: '渋谷' }, null), null);
  assert.equal(lastTrainUrl({ date: '2026-12-05', venue_station: '渋谷' }, '  '), null);
  assert.equal(lastTrainUrl({ date: '2026-12-05' }, '新宿'), null);
});

test('directionsUrl: 会場名と住所をエンコードして渡す', () => {
  const url = directionsUrl({ venue: '会場A&B', venue_address: '東京都#1' });
  assert.equal(
    url,
    `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent('会場A&B 東京都#1')}&travelmode=transit`,
  );
});

test('directionsUrl: 片方だけでも作れる・前後の空白は除く', () => {
  assert.match(directionsUrl({ venue: ' 会場A\u3000' }), new RegExp(`destination=${encodeURIComponent('会場A')}&`));
  assert.match(directionsUrl({ venue_address: '東京都1' }), new RegExp(`destination=${encodeURIComponent('東京都1')}&`));
});

test('nearbyUrl: 周辺 飲食店 を付ける', () => {
  assert.equal(
    nearbyUrl({ venue: '会場A' }),
    `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent('会場A 周辺 飲食店')}`,
  );
  assert.match(nearbyUrl({ venue: '会場A', venue_address: '東京都1' }), new RegExp(`query=${encodeURIComponent('会場A 東京都1 周辺 飲食店')}$`));
});

test('directionsUrl・nearbyUrl: 会場名も住所も空なら null', () => {
  assert.equal(directionsUrl({}), null);
  assert.equal(directionsUrl({ venue: ' ', venue_address: '\u3000' }), null);
  assert.equal(nearbyUrl({ venue: '', venue_address: null }), null);
  assert.equal(nearbyUrl({}), null);
});

import { lastTrainState } from '../src/core/live-links.js';

test('lastTrainState: 出し分け', () => {
  const base = { date: '2026-11-20' };
  const a = lastTrainState({ ...base, venue_station: '' }, null);
  assert.deepEqual([a.url, a.needVenueStation, a.needHome], [null, true, true]);
  const b = lastTrainState({ ...base, venue_station: '渋谷駅' }, '');
  assert.deepEqual([b.url, b.needVenueStation, b.needHome], [null, false, true]);
  const c = lastTrainState({ ...base, venue_station: null }, '新宿');
  assert.deepEqual([c.url, c.needVenueStation, c.needHome], [null, true, false]);
  const d = lastTrainState({ ...base, venue_station: '渋谷駅' }, '新宿');
  assert.ok(d.url.startsWith('https://transit.yahoo.co.jp/'));
  assert.deepEqual([d.needVenueStation, d.needHome], [false, false]);
});

test('lastTrainState: 最寄り駅が読み込めなかった（undefined）ときは、未設定のヒントではなく失敗として返す', () => {
  const live = { date: '2026-11-20', venue_station: '渋谷駅' };
  const f = lastTrainState(live, undefined);
  assert.deepEqual([f.url, f.needVenueStation, f.needHome, f.homeFailed], [null, false, false, true]);
  assert.equal(lastTrainState(live, null).homeFailed, false); // null は「未設定」
  assert.equal(lastTrainState(live, null).needHome, true);
  assert.equal(lastTrainState(live, '新宿').homeFailed, false);
});
