import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renameTrack, addSetlistTrack } from '../src/core/setlist-edit.js';

const base = () => [
  { title: '曲A', artistName: 'X', source: 'setlist', isLatest: false, uncertain: true },
  { title: '曲B', artistName: 'X', source: 'setlist', isLatest: false, uncertain: true },
];

test('renameTrack: 曲名を直し、uncertain は false・他の項目は残る。元は変えない', () => {
  const t = base();
  const r = renameTrack(t, 1, '  曲C  ');
  assert.equal(r[1].title, '曲C');
  assert.equal(r[1].uncertain, false);
  assert.equal(r[1].artistName, 'X');
  assert.equal(r[1].source, 'setlist');
  assert.deepEqual(r[0], t[0]);
  assert.notEqual(r, t);
  assert.deepEqual(t, base());
});

test('renameTrack: 空・空白だけ・範囲外では変わらない', () => {
  const t = base();
  assert.deepEqual(renameTrack(t, 0, '   '), base());
  assert.deepEqual(renameTrack(t, 0, ''), base());
  assert.deepEqual(renameTrack(t, 5, '曲C'), base());
  assert.deepEqual(renameTrack(t, -1, '曲C'), base());
});

test('addSetlistTrack: 同じ曲名でも足す。形は toSetlistTracks と同じ', () => {
  const t = [{ title: '曲A', artistName: 'X', source: 'setlist', isLatest: false, uncertain: false }];
  const r = addSetlistTrack(t, ' 曲A ', 'X');
  assert.equal(r.length, 2);
  assert.deepEqual(r[1], { title: '曲A', artistName: 'X', source: 'setlist', isLatest: false, uncertain: false });
  assert.equal(t.length, 1);
});

test('addSetlistTrack: 空は足さない', () => {
  const t = base();
  assert.deepEqual(addSetlistTrack(t, '  ', 'X'), base());
  assert.deepEqual(addSetlistTrack(t, '', 'X'), base());
});
