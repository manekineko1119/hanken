import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHash, playlistHref } from '../src/router.js';

test('ライブの詳細：パラメータとクエリを取り出す', () => {
  assert.deepEqual(parseHash('#/live/abc?confirm=1'), {
    path: '/live/:id',
    params: { id: 'abc' },
    query: { confirm: '1' },
  });
});

test('プレイリストの編集', () => {
  assert.deepEqual(parseHash('#/playlist/p1'), {
    path: '/playlist/:id',
    params: { id: 'p1' },
    query: {},
  });
});

test('プレイリストの保存確認：従来のハッシュを使い、ID をエンコードする', () => {
  assert.equal(playlistHref('abc-123', { confirm: true }), '#/playlist/abc-123?confirm=1');
  assert.equal(playlistHref('a b', { confirm: true }), '#/playlist/a%20b?confirm=1');
});

test('URLSearchParams.size がなくても保存確認と一覧の戻り先を残す', (t) => {
  t.mock.getter(URLSearchParams.prototype, 'size', () => undefined);
  assert.equal(playlistHref('p1', { fromPrep: true, confirm: true }), '#/playlist/p1?confirm=1&from=prep');
});

test('空や知らないパスは /lives に戻す', () => {
  const fallback = { path: '/lives', params: {}, query: {} };
  assert.deepEqual(parseHash(''), fallback);
  assert.deepEqual(parseHash('#'), fallback);
  assert.deepEqual(parseHash('#/unknown'), fallback);
  assert.deepEqual(parseHash('#/live/a/b/c/d'), fallback);
});

test('パラメータのないパス', () => {
  for (const p of ['/login', '/lives', '/live/new', '/artist-pick', '/prep', '/settings']) {
    assert.deepEqual(parseHash('#' + p), { path: p, params: {}, query: {} });
  }
});

test('編集とセトリのパス', () => {
  assert.deepEqual(parseHash('#/live/L1/edit'), {
    path: '/live/:id/edit',
    params: { id: 'L1' },
    query: {},
  });
  assert.deepEqual(parseHash('#/live/L1/setlist/A9'), {
    path: '/live/:id/setlist/:artistId',
    params: { id: 'L1', artistId: 'A9' },
    query: {},
  });
});

test('URL エンコードを戻す', () => {
  assert.deepEqual(parseHash('#/live/a%20b?q=%E3%81%82&k=v'), {
    path: '/live/:id',
    params: { id: 'a b' },
    query: { q: 'あ', k: 'v' },
  });
});
