import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickArtist, orderArtists, buildInitialTracks, replaceTrack, hasPopularity, moveTrack, addManualTrack, prepArtistName } from '../src/core/prep.js';

const pop = (n) => Array.from({ length: n }, (_, i) => ({ title: `P${i + 1}`, source: 'lastfm' }));
const rec = (n) => Array.from({ length: n }, (_, i) => ({ title: `R${i + 1}`, source: 'itunes' }));

test('pickArtist: 完全一致がちょうど1つのときだけ返す', () => {
  assert.equal(pickArtist('バンドA', [{ name: 'バンドA' }, { name: 'バンドA' }]), null);
  assert.deepEqual(pickArtist('バンドａ', [{ id: 1, name: 'バンドA' }, { id: 2, name: 'バンドB' }]), { id: 1, name: 'バンドA' });
  assert.equal(pickArtist('バンドC', [{ name: 'バンドA' }]), null);
});

test('orderArtists: 完全一致 → 含む → そのほか、組の中は元の順', () => {
  const c = [{ name: 'Zeta' }, { name: 'Foo Band 2' }, { name: 'foo band' }, { name: 'Alpha' }, { name: 'Foo Band 1' }, { name: 'xy' }];
  assert.deepEqual(orderArtists('Foo Band', c).map((x) => x.name),
    ['foo band', 'Foo Band 2', 'Foo Band 1', 'Zeta', 'Alpha', 'xy']);
});

test('orderArtists: 逆向きの包含（名前が query に含まれる）も含む扱い', () => {
  const c = [{ name: 'Other' }, { name: 'Foo' }];
  assert.deepEqual(orderArtists('Foo Band', c).map((x) => x.name), ['Foo', 'Other']);
});

test('buildInitialTracks: popular15・recent5 → 10曲、最後だけ最新', () => {
  const { tracks } = buildInitialTracks({ popular: pop(15), recent: rec(5) }, 'バンドA');
  assert.equal(tracks.length, 10);
  assert.deepEqual(tracks.slice(0, 9).map((t) => t.title), ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8', 'P9']);
  assert.equal(tracks.filter((t) => t.isLatest).length, 1);
  assert.equal(tracks[9].isLatest, true);
  assert.equal(tracks[9].title, 'R1');
  assert.equal(tracks[0].artistName, 'バンドA');
});

test('buildInitialTracks: recent 先頭が popular にもあるとき重複しない', () => {
  const popular = [{ title: 'R1', source: 'lastfm' }, ...pop(14)];
  const { tracks } = buildInitialTracks({ popular, recent: rec(5) }, 'A');
  assert.equal(tracks.length, 10);
  assert.equal(tracks.filter((t) => t.title === 'R1').length, 1);
  assert.equal(tracks[9].title, 'R1');
  assert.equal(tracks[9].isLatest, true);
  assert.deepEqual(tracks.slice(0, 9).map((t) => t.title), ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8', 'P9']);
});

test('buildInitialTracks: popular 3曲 → recent で埋めて10曲', () => {
  const { tracks } = buildInitialTracks({ popular: pop(3), recent: rec(8) }, 'A');
  assert.equal(tracks.length, 10);
  assert.equal(tracks[9].isLatest, true);
  assert.equal(tracks[9].title, 'R1');
  assert.deepEqual(tracks.slice(0, 3).map((t) => t.title), ['P1', 'P2', 'P3']);
  assert.equal(new Set(tracks.map((t) => t.title)).size, 10);
});

test('buildInitialTracks: popular 空 → recent だけで10曲', () => {
  const { tracks } = buildInitialTracks({ popular: [], recent: rec(12) }, 'A');
  assert.equal(tracks.length, 10);
  assert.equal(tracks.filter((t) => t.isLatest).length, 1);
  assert.equal(tracks[9].isLatest, true);
  assert.equal(tracks[9].title, 'R1');
});

test('replaceTrack: 普通の曲を消すと popular の残りの先頭が入る', () => {
  const init = buildInitialTracks({ popular: pop(15), recent: rec(5) }, 'A');
  const r = replaceTrack(init.tracks, init.rest, 2, 'A');
  assert.equal(r.tracks.length, 10);
  assert.ok(!r.tracks.some((t) => t.title === 'P3'));
  assert.ok(r.tracks.some((t) => t.title === 'P10' && !t.isLatest));
  assert.equal(r.tracks[9].isLatest, true);
});

test('replaceTrack: 最新の枠を消すと recent の次が最新で最後に入る', () => {
  const init = buildInitialTracks({ popular: pop(15), recent: rec(5) }, 'A');
  const r = replaceTrack(init.tracks, init.rest, 9, 'A');
  assert.equal(r.tracks.length, 10);
  assert.equal(r.tracks[9].title, 'R2');
  assert.equal(r.tracks[9].isLatest, true);
  assert.equal(r.tracks.filter((t) => t.isLatest).length, 1);
});

test('replaceTrack: 候補が尽きると9曲になる', () => {
  const init = buildInitialTracks({ popular: pop(9), recent: rec(1) }, 'A');
  assert.equal(init.tracks.length, 10);
  const r = replaceTrack(init.tracks, init.rest, 0, 'A');
  assert.equal(r.tracks.length, 9);
});

test('replaceTrack: 元の配列を変えない', () => {
  const init = buildInitialTracks({ popular: pop(15), recent: rec(5) }, 'A');
  const before = JSON.stringify(init);
  replaceTrack(init.tracks, init.rest, 0, 'A');
  assert.equal(JSON.stringify(init), before);
});

test('pickArtist: 空の query は null', () => {
  assert.equal(pickArtist('', [{ name: '！' }]), null);
  assert.equal(pickArtist('  ', [{ name: '' }]), null);
});

test('replaceTrack: 消した曲が rest に残っていても出し直さない', () => {
  const init = buildInitialTracks({ popular: pop(15), recent: rec(5) }, 'A');
  const tracks = [...init.tracks.slice(0, 9), { title: 'P10', artistName: 'A', source: 'manual', isLatest: false }];
  tracks.push(init.tracks[9]);
  const r = replaceTrack(tracks, init.rest, 9, 'A');
  assert.ok(!r.tracks.some((t) => t.title === 'P10'));
  assert.ok(r.tracks.some((t) => t.title === 'P11'));
  assert.ok(!r.rest.popular.some((c) => c.title === 'P10'));
});

test('replaceTrack: index が範囲外なら何もしない', () => {
  const init = buildInitialTracks({ popular: pop(15), recent: rec(5) }, 'A');
  for (const i of [-1, 10, 99, 1.5]) {
    const r = replaceTrack(init.tracks, init.rest, i, 'A');
    assert.equal(r.tracks.length, 10);
    assert.deepEqual(r.tracks, init.tracks);
  }
});

const T = (title, isLatest = false) => ({ title, artistName: 'A', source: 'itunes', isLatest });

test('hasPopularity: lastfm の曲か rest.popular があれば true', () => {
  assert.equal(hasPopularity([T('a')], { popular: [], recent: [] }), false);
  assert.equal(hasPopularity([{ ...T('a'), source: 'lastfm' }], { popular: [], recent: [] }), true);
  assert.equal(hasPopularity([T('a')], { popular: [{ title: 'x', source: 'lastfm' }], recent: [] }), true);
  assert.equal(hasPopularity([T('a')], null), false);
});

test('moveTrack: 上下に動かす。最新の枠は最後のまま', () => {
  const ts = [T('a'), T('b'), T('c'), T('L', true)];
  assert.deepEqual(moveTrack(ts, 1, 'up').map((t) => t.title), ['b', 'a', 'c', 'L']);
  assert.deepEqual(moveTrack(ts, 1, 'down').map((t) => t.title), ['a', 'c', 'b', 'L']);
  assert.equal(moveTrack(ts, 0, 'up'), ts);
  assert.equal(moveTrack(ts, 2, 'down'), ts); // 最新の下へは動かせない
  assert.equal(moveTrack(ts, 3, 'up'), ts); // 最新は動かせない
  assert.equal(moveTrack(ts, 9, 'up'), ts);
});

test('addManualTrack: 最新の枠の前に足す。空・重複は無視', () => {
  const ts = [T('a'), T('L', true)];
  const r = addManualTrack(ts, '  新曲 ', 'A');
  assert.deepEqual(r.tracks.map((t) => t.title), ['a', '新曲', 'L']);
  assert.deepEqual(r.tracks[1], { title: '新曲', artistName: 'A', source: 'manual', isLatest: false });
  assert.equal(r.duplicate, false);
  assert.deepEqual(addManualTrack([T('a')], '新曲', 'A').tracks.map((t) => t.title), ['a', '新曲']);
  const dup = addManualTrack(ts, 'Ａ', 'A');
  assert.equal(dup.tracks, ts);
  assert.equal(dup.duplicate, true);
  const empty = addManualTrack(ts, '   ', 'A');
  assert.equal(empty.tracks, ts);
  assert.equal(empty.duplicate, false);
});

test('prepArtistName：選んだ iTunes の候補の正式な名前を使う（入力した名前ではない）', () => {
  assert.equal(prepArtistName('あわくもろく', { id: 1, name: '泡く、脆く。' }), '泡く、脆く。');
  assert.equal(prepArtistName('ヨルシカ', { id: 2, name: ' ヨルシカ ' }), 'ヨルシカ');
});

test('prepArtistName：候補に名前がないときは、入力した名前', () => {
  assert.equal(prepArtistName('あわくもろく', { id: 1 }), 'あわくもろく');
  assert.equal(prepArtistName('あわくもろく', { id: 1, name: '  ' }), 'あわくもろく');
  assert.equal(prepArtistName('あわくもろく', null), 'あわくもろく');
});
