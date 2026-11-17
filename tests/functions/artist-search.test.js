import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handle } from '../../supabase/functions/artist-search/handler.js';
import { makeDeps, post, ORIGIN } from './helpers.js';

const itunes = { results: [{ artistId: 1, artistName: 'Aizora to Tsuki', primaryGenreName: 'J-Pop', x: 1 }] };

test('OPTIONS preflight は 204 で許可した Origin を返す', async () => {
  const { deps } = makeDeps();
  const res = await handle(new Request('http://fn/x', { method: 'OPTIONS', headers: { Origin: ORIGIN } }), deps);
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), ORIGIN);
});

test('APP_ORIGIN は許可、知らない Origin には ACAO を付けない', async () => {
  const { deps } = makeDeps({ env: { APP_ORIGIN: 'https://app.example' } });
  const ok = await handle(new Request('http://fn/x', { method: 'OPTIONS', headers: { Origin: 'https://app.example' } }), deps);
  assert.equal(ok.headers.get('Access-Control-Allow-Origin'), 'https://app.example');
  const ng = await handle(new Request('http://fn/x', { method: 'OPTIONS', headers: { Origin: 'https://evil.example' } }), deps);
  assert.equal(ng.headers.get('Access-Control-Allow-Origin'), null);
});

test('POST 以外は 405', async () => {
  const { deps } = makeDeps();
  const res = await handle(new Request('http://fn/x', { method: 'GET', headers: { Origin: ORIGIN } }), deps);
  assert.equal(res.status, 405);
});

test('JWT なし・不正は 401 NOT_ALLOWED', async () => {
  const { deps } = makeDeps();
  for (const jwt of [null, 'badjwt']) {
    const res = await handle(post({ name: 'x' }, { jwt }), deps);
    assert.equal(res.status, 401);
    assert.equal((await res.json()).error.code, 'NOT_ALLOWED');
  }
});

test('許可リストにないメールは 403 NOT_ALLOWED', async () => {
  const { deps } = makeDeps({ allowed: false });
  const res = await handle(post({ name: 'x' }), deps);
  assert.equal(res.status, 403);
  assert.equal((await res.json()).error.code, 'NOT_ALLOWED');
});

test('名前が空・101文字・文字列でないは 400 BAD_INPUT', async () => {
  const { deps, calls } = makeDeps();
  for (const name of ['', '   ', 'a'.repeat(101), 5, undefined]) {
    const res = await handle(post({ name }), deps);
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error.code, 'BAD_INPUT');
  }
  assert.equal(calls.length, 0);
});

test('iTunes の結果を id・name・genre に写す（名前は trim して URL に入れる）', async () => {
  const { deps, calls } = makeDeps({ fetchMap: () => ({ body: itunes }) });
  const res = await handle(post({ name: '  藍空と月 ' }), deps);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { candidates: [{ id: 1, name: 'Aizora to Tsuki', genre: 'J-Pop' }] });
  assert.equal(calls[0], `https://itunes.apple.com/search?term=${encodeURIComponent('藍空と月')}&entity=musicArtist&country=JP&limit=10`);
});

test('iTunes が 500・通信エラーなら 502 UPSTREAM', async () => {
  for (const fetchMap of [() => ({ status: 500, body: {} }), () => { throw new Error('net'); }]) {
    const { deps } = makeDeps({ fetchMap });
    const res = await handle(post({ name: 'x' }), deps);
    assert.equal(res.status, 502);
    assert.equal((await res.json()).error.code, 'UPSTREAM');
  }
});

test('APP_ORIGIN の末尾の / は無視して比べる', async () => {
  const { deps } = makeDeps({ env: { APP_ORIGIN: 'https://app.example/' } });
  const res = await handle(new Request('http://fn/x', { method: 'OPTIONS', headers: { Origin: 'https://app.example' } }), deps);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), 'https://app.example');
});

test('iTunes の results が配列でないなら 502 UPSTREAM', async () => {
  for (const b of [{ results: 'x' }, { results: {} }, {}, null]) {
    const { deps } = makeDeps({ fetchMap: () => ({ body: b }) });
    const res = await handle(post({ name: 'x' }), deps);
    assert.equal(res.status, 502);
  }
});
