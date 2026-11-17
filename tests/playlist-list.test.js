import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sortPlaylists, filterPlaylists, needsReflect, youtubeMusicUrl } from '../src/core/playlist-list.js';

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

test('filterPlaylists: 状態で絞る', () => {
  assert.equal(filterPlaylists([a, b, c], { status: 'all', text: '' }).length, 3);
  assert.deepEqual(filterPlaylists([a, b, c], { status: 'saved', text: '' }).map((p) => p.id), ['b']);
  assert.deepEqual(filterPlaylists([a, b, c], { status: 'draft', text: '' }).map((p) => p.id), ['a', 'c']);
});

test('filterPlaylists: アーティスト名かタイトルで絞る（大文字小文字・前後の空白を無視）', () => {
  const x = mk('x', { title: 'Summer Songs', artistName: 'Kaze' });
  const y = mk('y', { title: '予習', artistName: 'Umi' });
  assert.deepEqual(filterPlaylists([x, y], { status: 'all', text: '  kaze ' }).map((p) => p.id), ['x']);
  assert.deepEqual(filterPlaylists([x, y], { status: 'all', text: 'summer' }).map((p) => p.id), ['x']);
  assert.deepEqual(filterPlaylists([x, y], { status: 'all', text: '予' }).map((p) => p.id), ['y']);
  assert.deepEqual(filterPlaylists([x, y], { status: 'saved', text: 'kaze' }), []);
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
