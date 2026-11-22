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
  assert.deepEqual(titles(toSetlist(lines('M87 (live)'))), ['M87 (live)']); // (live) は曲名の一部のことがあるので残す
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

test('toSetlist: 曲名の後ろのメモを除く', () => {
  const one = (t) => titles(toSetlist(lines(t)))[0];
  assert.equal(one('3.曲C cover'), '曲C');
  assert.equal(one('4.曲D 同期あり'), '曲D');
  assert.equal(one('M1 曲E カポ2'), '曲E');
  assert.equal(one('1.曲F(Acoustic)'), '曲F');
  assert.equal(one('1.曲F（Acoustic）'), '曲F');
  assert.equal(one('2.曲G バラードver.'), '曲G');
  assert.equal(one('2.曲G Acoustic ver.'), '曲G');
  assert.equal(one('M1 曲H 1'), '曲H 1'); // 後ろの数字は曲名の一部のことがあるので残す（手で消す）
  assert.equal(one('0.曲I inst'), '曲I');
  assert.equal(one('曲J(inst)'), '曲J');
  assert.equal(one('1.曲K capo 3 同期あり'), '曲K');
  assert.equal(one('同期あり'), '同期あり');
  assert.equal(one('Track 2'), 'Track 2');
  assert.equal(one('Never Forever'), 'Never Forever');
});

const full = (...a) => toSetlist(lines(...a));

test('toSetlist: 写真の形 a（括弧のメモ・MC(一言)）', () => {
  assert.deepEqual(titles(full('バンド名', '「ツアー 2023」', '2023.08.19@ 会場', '曲Z(inst)', '1.曲A(Acoustic)', 'MC(一言)', '2.曲B(Acoustic)', 'MC', '3.曲C', 'MC', '4.曲D', 'MC(一言)', '5.曲E')), ['曲A', '曲B', '曲C', '曲D', '曲E']);
});

test('toSetlist: 写真の形 b（0番から・同期あり）', () => {
  assert.deepEqual(titles(full('2024/03/07 会場 SETLIST', '--入場SE--', '0.曲Z inst', 'MC 一言', '1.曲A', '2.曲B バラードver.', 'MC', '3.曲C cover', 'MC', '4.曲D 同期あり', 'MC', '5.曲E 同期あり', 'MC', '6.曲F。同期あり', '-だれかさん退散-', 'MC', '7.曲G')), ['曲Z', '曲A', '曲B', '曲C', '曲D', '曲E', '曲F。', '曲G']);
});

test('toSetlist: 写真の形 c（En1.）', () => {
  const r = full('20番', '2024/11/02', 'バンド「ライブ vol.2」セトリ', '1. 曲A', '2. 曲B', '3. 曲C', '-MC-', '4. 曲D', '5. 曲E', 'En1. 曲F', 'En2. 曲G');
  assert.deepEqual(titles(r), ['曲A', '曲B', '曲C', '曲D', '曲E', '曲F', '曲G']);
  assert.deepEqual(r.sections, [{ before_index: 3, label: '-MC-' }, { before_index: 5, label: 'En' }]);
});

test('toSetlist: 写真の形 d（番号だけの行・en1）', () => {
  assert.deepEqual(titles(full('2024.11.15 @会場', '1. 曲A', '2. 曲B', '3. 曲C', 'mc', '4', '曲D', '5. 曲E', 'mc', '7. 曲G', 'en1 曲H', 'en2 曲I')), ['曲A', '曲B', '曲C', '曲D', '曲E', '曲G', '曲H', '曲I']);
});

test('toSetlist: 写真の形 e（M 番号・カポ・手書きの 1）', () => {
  assert.deepEqual(titles(full('11/15 会場', 'バンド oneman live project『タイトル』第二夜', 'M1 曲A', 'M2 SONGB', 'M3 SONGC カポ2', 'M4 songd', 'M5 曲E カポ4', '-MC-', 'M7 曲G カポ3', 'M8 曲H 1')), ['曲A', 'SONGB', 'SONGC', 'songd', '曲E', '曲G', '曲H 1']);
});

test('toSetlist: アンコールの書き方いろいろ', () => {
  for (const w of ['En1. 曲A', 'en1 曲A', 'en 1. 曲A', 'EN1曲A']) {
    assert.deepEqual(titles(full('1. X', '2. Y', '3. Z', w)), ['X', 'Y', 'Z', '曲A'], w);
  }
});

test('toSetlist: 番号付きの曲名の後ろの数字は消さない', () => {
  assert.deepEqual(titles(full('1. Part 2', '2. Apollo 11', '3. Song 2', '4. Summer of 69')), ['Part 2', 'Apollo 11', 'Song 2', 'Summer of 69']);
});

test('toSetlist: 番号なしのセトリでは cover・inst・(Live) を除かない', () => {
  assert.deepEqual(titles(full('Undercover', 'Take Cover', 'Pure Inst', 'Alpha (Live)')), ['Undercover', 'Take Cover', 'Pure Inst', 'Alpha (Live)']);
  assert.deepEqual(titles(full('1. 曲A cover', '2. 曲B inst', '3. 曲C')), ['曲A', '曲B', '曲C']);
});

test('toSetlist: 括弧は acoustic・inst・ver.・version の単語だけ除く', () => {
  const one = (t) => titles(full('1. X', '2. Y', t))[2];
  assert.equal(one('3. 曲A (Never Again)'), '曲A (Never Again)');
  assert.equal(one('3. 曲A (Live)'), '曲A (Live)');
  assert.equal(one('3. 曲A (Remix)'), '曲A (Remix)');
  assert.equal(one('3. 曲A (Instinct)'), '曲A (Instinct)');
  assert.equal(one('3. 曲A (Acoustic Ver.)'), '曲A');
  assert.equal(one('3. 曲A (Instrumental)'), '曲A');
  assert.equal(one('3. 曲A（バラードver.）'), '曲A');
  assert.equal(one('3. Love Verbal'), 'Love Verbal');
  assert.equal(one('3. So Clever.'), 'So Clever.');
});

test('toSetlist: アンコールのあとも本編の番号の続きを受ける', () => {
  assert.deepEqual(titles(full('M1 曲A', 'M2 曲B', 'M3 曲C', 'EN1 曲D', 'M4 曲E')), ['曲A', '曲B', '曲C', '曲D', '曲E']);
  assert.deepEqual(titles(full('1 曲A', '2 曲B', '3 曲C', 'EN1 曲D', '4 曲E')), ['曲A', '曲B', '曲C', '曲D', '曲E']);
  const ten = Array.from({ length: 9 }, (_, i) => `M${i + 1} 曲${i + 1}`);
  assert.deepEqual(titles(full(...ten, 'EN1 曲X', 'M10 曲10')), [...ten.map((_, i) => `曲${i + 1}`), '曲X', '曲10']);
});

test('toSetlist: M 付きの番号は、大きくなればいくつ飛んでも受ける', () => {
  assert.deepEqual(titles(full('M1 曲A', 'M2 曲B', 'M3 曲C', 'M8 曲H', 'M9 曲I')), ['曲A', '曲B', '曲C', '曲H', '曲I']);
  assert.deepEqual(titles(full('M1 曲A', 'M2 曲B', 'M3 曲C', 'M8', '曲H')), ['曲A', '曲B', '曲C', '曲H']);
});

test('toSetlist: 「N.」の後ろが数字なら番号にしない（日付）', () => {
  assert.deepEqual(titles(full('11.22 会場', '1. 曲A', '2. 曲B', '3. 曲C')), ['曲A', '曲B', '曲C']);
  assert.deepEqual(titles(full('11.22 会場')), ['11.22 会場']);
});

test('toSetlist: Codex の指摘（Version 2・(ver)・(Inst2)・括弧の曲名・1)1979・M の飛び）', () => {
  assert.deepEqual(titles(full('1. The Version 2', '2. Alpha (ver)', '3. Beta (Inst2)')), ['The Version 2', 'Alpha (ver)', 'Beta (Inst2)']);
  assert.deepEqual(titles(full('1 Alpha', '2 (Everything)', '3 Gamma', '4 Delta')), ['Alpha', '(Everything)', 'Gamma', 'Delta']);
  assert.deepEqual(titles(full('1)1979', '2:1985', '3. Closer', '4. Midnight', '5. Outro')), ['1979', '1985', 'Closer', 'Midnight', 'Outro']);
  assert.deepEqual(titles(full('M1 Alpha', 'M8 Apollo 11')), ['Alpha', 'Apollo 11']);
  assert.deepEqual(titles(full('M1 Alpha', 'M2 Beta', 'M3 Gamma', 'M8.', 'Apollo 11')), ['Alpha', 'Beta', 'Gamma', 'Apollo 11']);
});
