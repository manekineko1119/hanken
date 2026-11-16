import { test } from 'node:test';
import assert from 'node:assert/strict';
import { playlistTitle } from '../src/core/naming.js';

test('playlistTitle: 予習', () => {
  assert.equal(playlistTitle({ kind: 'prep', artistName: 'バンドA', date: '2026-12-01', venue: '会場X' }), '【予習】バンドA（2026-12-01 会場X）');
  assert.equal(playlistTitle({ kind: 'prep', artistName: 'バンドA', date: '2026-12-01' }), '【予習】バンドA（2026-12-01）');
  assert.equal(playlistTitle({ kind: 'prep', artistName: 'バンドA', venue: '会場X' }), '【予習】バンドA（会場X）');
  assert.equal(playlistTitle({ kind: 'prep', artistName: 'バンドA' }), '【予習】バンドA');
});

test('playlistTitle: セットリスト', () => {
  assert.equal(playlistTitle({ kind: 'setlist', artistName: 'バンドA', date: '2026-12-01', venue: '会場X' }), '【セトリ】バンドA（2026-12-01 会場X）');
  assert.equal(playlistTitle({ kind: 'setlist', artistName: 'バンドA' }), '【セトリ】バンドA');
});
