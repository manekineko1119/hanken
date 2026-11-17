import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sortPlaylists, filterPlaylists, needsReflect, youtubeMusicUrl, normalizePref, deleteConfirmText, renameWhere } from '../src/core/playlist-list.js';

const mk = (id, o = {}) => ({ id, title: `T${id}`, artistName: 'A', status: 'draft', createdAt: '2026-11-01T00:00:00Z', live: null, ...o });
const a = mk('a', { createdAt: '2026-11-01T00:00:00Z', live: { date: '2026-12-10', venue: 'X' } });
const b = mk('b', { createdAt: '2026-11-03T00:00:00Z', status: 'saved', live: null });
const c = mk('c', { createdAt: '2026-11-02T00:00:00Z', live: { date: '2026-12-01', venue: null } });

test('sortPlaylists: 新しい順（既定）・古い順', () => {
  assert.deepEqual(sortPlaylists([a, b, c], 'newest').map((p) => p.id), ['b', 'c', 'a']);
  assert.deepEqual(sortPlaylists([a, b, c], 'oldest').map((p) => p.id), ['a', 'c', 'b']);
  assert.deepEqual(sortPlaylists([a, b, c], 'unknown').map((p) => p.id), ['b', 'c', 'a']);
});

test('sortPlaylists: ライブの日付順（早い順。ライブなしは最後）。元の配列は変えない', () => {
  const input = [a, b, c];
  assert.deepEqual(sortPlaylists(input, 'live-date').map((p) => p.id), ['c', 'a', 'b']);
  assert.deepEqual(input.map((p) => p.id), ['a', 'b', 'c']);
});

test('filterPlaylists: 種類（予習・セトリ）で絞る', () => {
  const s1 = mk('s1', { kind: 'setlist' });
  const p1 = mk('p1', { kind: 'prep' });
  assert.equal(filterPlaylists([s1, p1], { kind: 'all', text: '' }).length, 2);
  assert.deepEqual(filterPlaylists([s1, p1], { kind: 'prep', text: '' }).map((p) => p.id), ['p1']);
  assert.deepEqual(filterPlaylists([s1, p1], { kind: 'setlist', text: '' }).map((p) => p.id), ['s1']);
  assert.deepEqual(filterPlaylists([p1], { kind: 'setlist', text: '' }), []);
});

test('normalizePref: 古い保存値・壊れた値は既定に直す', () => {
  assert.deepEqual(normalizePref(null), { sort: 'newest', kind: 'all', text: '' });
  assert.deepEqual(normalizePref({ sort: 'oldest', status: 'saved', text: 'x' }), { sort: 'oldest', kind: 'all', text: 'x' });
  assert.deepEqual(normalizePref({ sort: 'bogus', kind: 'setlist', text: 5 }), { sort: 'newest', kind: 'setlist', text: '' });
  assert.equal(normalizePref({ text: 'a'.repeat(300) }).text.length, 100);
});

test('filterPlaylists: アーティスト名かタイトルで絞る（大文字小文字・前後の空白を無視）', () => {
  const x = mk('x', { title: 'Summer Songs', artistName: 'Kaze' });
  const y = mk('y', { title: '予習', artistName: 'Umi' });
  assert.deepEqual(filterPlaylists([x, y], { kind: 'all', text: '  kaze ' }).map((p) => p.id), ['x']);
  assert.deepEqual(filterPlaylists([x, y], { kind: 'all', text: 'summer' }).map((p) => p.id), ['x']);
  assert.deepEqual(filterPlaylists([x, y], { kind: 'all', text: '予' }).map((p) => p.id), ['y']);
  assert.deepEqual(filterPlaylists([x, y], { kind: 'setlist', text: 'kaze' }), []);
});

test('needsReflect: 保存済みで、保存のあとに曲を変えたときだけ true', () => {
  assert.equal(needsReflect({ status: 'saved', savedAt: '2026-11-01T00:00:00Z', editedAt: '2026-11-02T00:00:00Z' }), true);
  assert.equal(needsReflect({ status: 'saved', savedAt: '2026-11-03T00:00:00Z', editedAt: '2026-11-02T00:00:00Z' }), false);
  assert.equal(needsReflect({ status: 'saved', savedAt: '2026-11-03T00:00:00Z', editedAt: null }), false);
  assert.equal(needsReflect({ status: 'saved', savedAt: null, editedAt: '2026-11-02T00:00:00Z' }), true);
  assert.equal(needsReflect({ status: 'draft', savedAt: null, editedAt: '2026-11-02T00:00:00Z' }), false);
});

test('youtubeMusicUrl', () => {
  assert.equal(youtubeMusicUrl('PL abc'), 'https://music.youtube.com/playlist?list=PL%20abc');
  assert.equal(youtubeMusicUrl(null), null);
});

test('needsReflect: 時刻の書き方（Z と +00:00）が混ざっても、時刻で比べる', () => {
  assert.equal(needsReflect({ status: 'saved', savedAt: '2026-11-01T10:00:00Z', editedAt: '2026-11-01T10:00:05.123456+00:00' }), true);
  assert.equal(needsReflect({ status: 'saved', savedAt: '2026-11-01T10:00:05.5+00:00', editedAt: '2026-11-01T10:00:05Z' }), false);
  assert.equal(needsReflect({ status: 'saved', savedAt: '2026-11-01T19:00:10+09:00', editedAt: '2026-11-01T10:00:05Z' }), false);
});

test('needsReflect: 読めない時刻は「反映済み」にしない／editedAt がなければ false', () => {
  assert.equal(needsReflect({ status: 'saved', savedAt: 'broken', editedAt: '2026-11-01T10:00:05Z' }), true);
  assert.equal(needsReflect({ status: 'saved', savedAt: '2026-11-01T10:00:05Z', editedAt: 'broken' }), false);
});

test('deleteConfirmText：YouTube に保存したものは残ると伝える', () => {
  const saved = deleteConfirmText({ title: '【予習】泡く、脆く。', youtubePlaylistId: 'PLx' });
  assert.match(saved, /【予習】泡く、脆く。/);
  assert.match(saved, /元に戻せません/);
  assert.match(saved, /YouTube.*残ります/);
});

test('deleteConfirmText：保存していない下書きには YouTube の話を出さない', () => {
  const draft = deleteConfirmText({ title: '【予習】あわくもろく', youtubePlaylistId: null });
  assert.match(draft, /元に戻せません/);
  assert.doesNotMatch(draft, /YouTube/);
});

test("renameWhere：YouTube にまだ保存していなければ、編集の画面でそのまま変える", () => {
  assert.equal(renameWhere({ youtubePlaylistId: null }), "here");
  assert.equal(renameWhere({}), "here");
});

test("renameWhere：YouTube に保存済みなら、保存の確認の画面で変える（YouTube 側の名前もそろえるため）", () => {
  assert.equal(renameWhere({ youtubePlaylistId: "PLx" }), "confirm");
});
