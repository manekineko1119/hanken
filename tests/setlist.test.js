import { test } from 'node:test';
import assert from 'node:assert/strict';
import { UNCERTAIN_BELOW, linesFromText, toSetlist, toSetlistTracks } from '../src/core/setlist.js';

const lines = (...a) => a.map((text) => ({ text }));
const titles = (r) => r.songs.map((s) => s.title);

test('linesFromText: 改行で分け、空行も残す', () => {
  const l = linesFromText('1. 曲A\r\n\r\n2. 曲B\n');
  assert.equal(l.length, 4);
  assert.deepEqual(titles(toSetlist(l)), ['曲A', '曲B']);
  assert.deepEqual(linesFromText('a\rb'), [{ text: 'a' }, { text: 'b' }]);
});

test('toSetlist: 番号を除く', () => {
  for (const t of ['01 曲A', '1)曲A', '①曲A', 'M1 曲A', 'M-1. 曲A', '1. 曲A', '１．曲A', '　２）　曲A　']) {
    assert.deepEqual(titles(toSetlist(lines(t))), ['曲A'], t);
  }
});

test('toSetlist: 番号でない数字は残す', () => {
  assert.deepEqual(titles(toSetlist(lines('1行目の記憶', '17才', 'M87'))), ['1行目の記憶', '17才', 'M87']);
});

test('toSetlist: 区切りは曲に入らず、次の曲の位置で入る', () => {
  for (const w of ['MC', 'ＳＥ', 'EN', 'encore', 'アンコール', 'W.EN', 'Wアンコール', '転換', '-- MC --']) {
    const r = toSetlist(lines('曲A', w, '曲B'));
    assert.deepEqual(titles(r), ['曲A', '曲B'], w);
    assert.deepEqual(r.sections, [{ before_index: 1, label: w }], w);
  }
});

test('toSetlist: 最後の区切りは songs.length、先頭は 0', () => {
  const r = toSetlist(lines('MC', '曲A', 'アンコール'));
  assert.deepEqual(r.sections, [{ before_index: 0, label: 'MC' }, { before_index: 1, label: 'アンコール' }]);
});

test('toSetlist: 区切りに似た曲名は曲', () => {
  assert.deepEqual(titles(toSetlist(lines('アンコールの歌', 'MC Hammer'))), ['アンコールの歌', 'MC Hammer']);
});

test('toSetlist: 同じ曲名は2曲のまま、空行は飛ばす', () => {
  assert.deepEqual(titles(toSetlist(lines('曲A', '', '  ', '曲A'))), ['曲A', '曲A']);
});

test('toSetlist: confidence の境目', () => {
  assert.equal(UNCERTAIN_BELOW, 0.8);
  const r = toSetlist([{ text: 'a', confidence: 0.79 }, { text: 'b', confidence: 0.8 }, { text: 'c' }]);
  assert.deepEqual(r.songs.map((s) => s.uncertain), [true, false, false]);
});

test('toSetlist: 空', () => {
  assert.deepEqual(toSetlist([]), { songs: [], sections: [] });
});

test('toSetlistTracks', () => {
  assert.deepEqual(toSetlistTracks([{ title: '曲A', uncertain: true }], 'バンドA'), [
    { title: '曲A', artistName: 'バンドA', source: 'setlist', isLatest: false, uncertain: true },
  ]);
});

test('toSetlist: 記号なしの数字は、曲の順番と同じときだけ番号', () => {
  assert.deepEqual(titles(toSetlist(lines('7 Rings'))), ['7 Rings']);
  assert.deepEqual(titles(toSetlist(lines('01 曲A', '02 曲B'))), ['曲A', '曲B']);
  assert.deepEqual(titles(toSetlist(lines('曲A', '曲B', '7 Rings'))), ['曲A', '曲B', '7 Rings']);
  assert.deepEqual(titles(toSetlist(lines('100 Reasons'))), ['100 Reasons']);
  assert.deepEqual(titles(toSetlist(lines('19 時の曲'))), ['19 時の曲']);
});

test('toSetlist: 番号付きの区切り', () => {
  for (const w of ['EN1', 'EN 1', 'アンコール1', 'MC①', 'MC2']) {
    const r = toSetlist(lines('曲A', w));
    assert.deepEqual(r.songs.length, 1, w);
    assert.deepEqual(r.sections, [{ before_index: 1, label: w }], w);
  }
  assert.deepEqual(titles(toSetlist(lines('MC Hammer'))), ['MC Hammer']);
});

test('toSetlist: 番号だけの行は読み飛ばす', () => {
  assert.deepEqual(toSetlist(lines('1.', '①', 'M1.')), { songs: [], sections: [] });
});

test('toSetlist: confidence が NaN なら要確認', () => {
  assert.equal(toSetlist([{ text: 'a', confidence: NaN }]).songs[0].uncertain, true);
  assert.equal(toSetlist([{ text: 'a', confidence: Infinity }]).songs[0].uncertain, true);
});

test('toSetlist: M と数字だけの曲名は消さない', () => {
  assert.deepEqual(titles(toSetlist(lines('M87'))), ['M87']);
  assert.deepEqual(titles(toSetlist(lines('M87 (live)'))), ['M87 (live)']);
  assert.deepEqual(titles(toSetlist(lines('M1 曲A'))), ['曲A']);
  assert.deepEqual(titles(toSetlist(lines('曲A', 'M1 曲B'))), ['曲A', 'M1 曲B']);
});

test('toSetlist: 番号付きのセトリでは、番号のない行を曲にしない', () => {
  const r = toSetlist(lines('冬のワンマン2026 TOUR', '2026.11.22 @港町ホール', 'M1 曲A', 'M2 曲B', 'MC', 'M3 曲C', 'EN1 曲D', 'EN2 曲B', 'サイン'));
  assert.deepEqual(titles(r), ['曲A', '曲B', '曲C', '曲D', '曲B']);
  assert.deepEqual(r.sections, [{ before_index: 2, label: 'MC' }, { before_index: 3, label: 'EN' }]);
  assert.deepEqual(titles(toSetlist(lines('ライブ名', '1. 曲A', '2. 曲B', '3. 曲C'))), ['曲A', '曲B', '曲C']);
});

test('toSetlist: 番号付きのセトリでも要確認の印を残す', () => {
  const r = toSetlist([{ text: 'ライブ名' }, { text: '1. 曲A', confidence: 0.5 }, { text: '2. 曲B', confidence: 0.9 }, { text: '3. 曲C' }]);
  assert.deepEqual(r.songs, [
    { title: '曲A', uncertain: true }, { title: '曲B', uncertain: false }, { title: '曲C', uncertain: false },
  ]);
});

test('toSetlist: 番号付きが2行だけなら、いままでどおり', () => {
  assert.deepEqual(titles(toSetlist(lines('タイトル', 'M1 曲A', 'M2 曲B'))), ['タイトル', 'M1 曲A', 'M2 曲B']);
});

test('toSetlist: 番号付きのセトリの中の「7 Rings」は、次の番号でなければ捨てる側にならず曲名の数字', () => {
  const r = toSetlist(lines('1. 曲A', '2. 曲B', '3. 曲C', '4 曲D'));
  assert.deepEqual(titles(r), ['曲A', '曲B', '曲C', '曲D']);
});

test('toSetlist: M1：曲A・M1:曲A', () => {
  assert.deepEqual(titles(toSetlist(lines('M1：曲A'))), ['曲A']);
  assert.deepEqual(titles(toSetlist(lines('M1:曲A'))), ['曲A']);
});

test('toSetlist: アンコールの番号付き（区切りを入れる・すでにあれば足さない）', () => {
  const r = toSetlist(lines('1. 曲A', '2. 曲B', '3. 曲C', 'アンコール', 'アンコール1 曲D', 'アンコール2 曲E'));
  assert.deepEqual(titles(r), ['曲A', '曲B', '曲C', '曲D', '曲E']);
  assert.deepEqual(r.sections, [{ before_index: 3, label: 'アンコール' }]);
  const r2 = toSetlist(lines('M1 曲A', 'M2 曲B', 'M3 曲C', 'W.EN1 曲D'));
  assert.deepEqual(r2.sections, [{ before_index: 3, label: 'W.EN' }]);
});

test('toSetlist: 番号と曲名が2行に割れても曲にする', () => {
  assert.deepEqual(titles(toSetlist(lines('M1 曲A', 'M2 曲B', 'M3 曲C', 'M4', '曲D', 'M5 曲E'))), ['曲A', '曲B', '曲C', '曲D', '曲E']);
  assert.deepEqual(titles(toSetlist(lines('1. 曲A', '2. 曲B', '3. 曲C', '④', '曲D'))), ['曲A', '曲B', '曲C', '曲D']);
  assert.deepEqual(titles(toSetlist(lines('1. 曲A', '2. 曲B', '3. 曲C', '4.'))), ['曲A', '曲B', '曲C']);
});

test('toSetlist: 番号が飛んでも、あとの曲を失わない', () => {
  assert.deepEqual(titles(toSetlist(lines('1 曲A', '2 曲B', '3 曲C', '5 曲E', '6 曲F'))), ['曲A', '曲B', '曲C', '曲E', '曲F']);
  assert.deepEqual(titles(toSetlist(lines('1 曲A', '2 曲B', '7 Rings', '3 曲C'))), ['曲A', '曲B', '曲C']);
});

test('toSetlist: 区切りのあとで番号が振り直されてもよい', () => {
  const r = toSetlist(lines('1. A', '2. B', '3. C', 'EN', '1 Delta', '2 Epsilon'));
  assert.deepEqual(titles(r), ['A', 'B', 'C', 'Delta', 'Epsilon']);
  assert.deepEqual(r.sections, [{ before_index: 3, label: 'EN' }]);
});

test('toSetlist: 番号付きのセトリの「M87 (live)」は番号のない行として捨てる', () => {
  assert.deepEqual(titles(toSetlist(lines('1. Alpha', '2. Beta', '3. Gamma', 'M87 (live)'))), ['Alpha', 'Beta', 'Gamma']);
});

test('toSetlist: 番号なしのセトリの「E1 Visa」は曲名のまま', () => {
  assert.deepEqual(titles(toSetlist(lines('曲A', 'E1 Visa', '曲B'))), ['曲A', 'E1 Visa', '曲B']);
  assert.deepEqual(titles(toSetlist(lines('EN1 a', 'EN2 b', 'E1 Visa'))), ['EN1 a', 'EN2 b', 'E1 Visa']);
});

test('toSetlist: アンコールの種類が変わったら区切りを足す', () => {
  const r = toSetlist(lines('1. A', '2. B', '3. C', 'EN1 D', 'EN2 E', 'W.EN1 F'));
  assert.deepEqual(r.sections, [{ before_index: 3, label: 'EN' }, { before_index: 5, label: 'W.EN' }]);
});
