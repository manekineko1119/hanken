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
