import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateLive, planArtistChanges, venueSuggestions, copyFromPastVenue, VENUE_COPY_KEYS } from '../src/core/live-form.js';

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

test('planArtistChanges：混在（空の名前は捨て、知らない id はその id で insert）', () => {
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
    { id: 'zzz', name: 'Z', position: 1 },
    { name: 'N', position: 2 },
  ]);
});

test('planArtistChanges：読み込んだ id を渡すと、読み込んだあとにほかで足された出演者は消さない', () => {
  // 画面を開いたときは a・b。そのあと別の端末で n が足された。
  const now = [...ex.slice(0, 2), { id: 'n', name: 'N', position: 2 }];
  const r = planArtistChanges(now, [{ id: 'a', name: 'A' }], ['a', 'b']);
  assert.deepEqual(r.deletes, ['b']);
  assert.deepEqual(r.updates.map((u) => u.id), ['a']);
});

test('planArtistChanges：読み込んだ id を渡さなければ、今までどおり（フォームにない行は全部消す）', () => {
  const r = planArtistChanges(ex, [{ id: 'a', name: 'A' }]);
  assert.deepEqual(r.deletes.sort(), ['b', 'c']);
});

test('planArtistChanges：新しい出演者に画面で付けた id があれば、その id で入れる（再試行で二重にしない）', () => {
  const r1 = planArtistChanges(ex, [...ex, { id: 'new-1', name: 'N' }], ['a', 'b', 'c']);
  assert.deepEqual(r1.inserts, [{ id: 'new-1', name: 'N', position: 3 }]);
  // 1回目の insert は DB に入ったが返事が届かなかった → もう一度押すと、同じ id なので update になる
  const now = [...ex, { id: 'new-1', name: 'N', position: 3 }];
  const r2 = planArtistChanges(now, [...ex, { id: 'new-1', name: 'N' }], ['a', 'b', 'c']);
  assert.deepEqual(r2.inserts, []);
  assert.deepEqual(r2.deletes, []);
  assert.ok(r2.updates.some((u) => u.id === 'new-1'));
});

test('deletableIds：開いたときの id ＋この画面で作った id。新しいライブは null', async () => {
  const { newArtist, deletableIds } = await import('../src/core/live-form.js');
  const state = { loadedIds: ['a'] };
  const n1 = newArtist(state);
  const n2 = newArtist(state);
  assert.notEqual(n1.id, n2.id);
  assert.deepEqual(deletableIds(state), ['a', n1.id, n2.id]);
  assert.equal(deletableIds({ loadedIds: null }), null);
});

const L = (id, date, venue, extra = {}) => ({ id, date, venue, ...extra });

test('venueSuggestions：重なり・空・空白だけを除き、新しい日付の順に返す', () => {
  const lives = [L('1', '2026-01-01', '会場A'), L('2', '2026-03-01', ' 会場B '), L('3', '2026-02-01', '会場A '), L('4', '2026-04-01', '  '), L('5', '2026-05-01', null)];
  assert.deepEqual(venueSuggestions(lives), ['会場B', '会場A']);
});

test('venueSuggestions：excludeId のライブは数えない', () => {
  const lives = [L('1', '2026-01-01', '会場A'), L('2', '2026-03-01', '会場B')];
  assert.deepEqual(venueSuggestions(lives, '2'), ['会場A']);
});

test('VENUE_COPY_KEYS：写す4項目', () => {
  assert.deepEqual(VENUE_COPY_KEYS, ['venue_address', 'venue_station', 'access_memo', 'last_train_memo']);
});

test('copyFromPastVenue：一番新しい同じ会場から、空の欄だけ写す', () => {
  const lives = [
    L('1', '2026-01-01', '会場A', { venue_address: '古い住所', venue_station: '古い駅' }),
    L('2', '2026-03-01', ' 会場A ', { venue_address: '新しい住所', venue_station: '新しい駅', access_memo: '徒歩5分', last_train_memo: '' }),
    L('3', '2026-05-01', '会場B', { venue_address: '別' }),
  ];
  const state = { id: 'x', venue_address: '', venue_station: '入力済み', access_memo: '  ', last_train_memo: '' };
  const copied = copyFromPastVenue(state, lives, '会場A');
  assert.deepEqual(copied, ['venue_address', 'access_memo']);
  assert.equal(state.venue_address, '新しい住所');
  assert.equal(state.venue_station, '入力済み');
  assert.equal(state.access_memo, '徒歩5分');
  assert.equal(state.last_train_memo, '');
});

test('copyFromPastVenue：自分自身（state.id）からは写さない', () => {
  const lives = [L('1', '2026-01-01', '会場A', { venue_address: '住所1' }), L('2', '2026-03-01', '会場A', { venue_address: '自分' })];
  const state = { id: '2', venue_address: '' };
  assert.deepEqual(copyFromPastVenue(state, lives, '会場A'), ['venue_address']);
  assert.equal(state.venue_address, '住所1');
});

test('copyFromPastVenue：見つからなければ何もしない', () => {
  const state = { id: null, venue_address: '' };
  assert.deepEqual(copyFromPastVenue(state, [L('1', '2026-01-01', '会場A', { venue_address: 'x' })], '会場Z'), []);
  assert.deepEqual(copyFromPastVenue(state, [], '会場A'), []);
  assert.deepEqual(copyFromPastVenue(state, [L('1', '2026-01-01', '会場A', { venue_address: 'x' })], '  '), []);
  assert.equal(state.venue_address, '');
});
