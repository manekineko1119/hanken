// YouTube とつなぐ流れ：callback（Google からの戻り）は鍵を「保留」に置くだけ。
// ログイン中のアプリが yt-connect-finish を呼び、同じ人だと確かめてから本当に保存する。
// （別の人に許可の URL を踏ませて、その人の YouTube の鍵を自分のアカウントに結び付けられないように）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handle as callback } from '../../supabase/functions/yt-connect-callback/handler.js';
import { handle as finish } from '../../supabase/functions/yt-connect-finish/handler.js';
import { decrypt } from '../../supabase/functions/_shared/crypto.js';
import { makeDeps, post, NOW } from './helpers.js';

const KEY = Buffer.alloc(32, 7).toString('base64');
const APP = 'https://example.test/hanken';
const env = {
  YT_TOKEN_KEY: KEY, YT_CLIENT_ID: 'cid', YT_CLIENT_SECRET: 'cs', YT_REDIRECT_URI: 'https://fn/cb', APP_ORIGIN: APP,
};
const later = (ms) => new Date(NOW.getTime() + ms).toISOString();
const state = (extra = {}) => ({ state: 'S1', user_id: 'u1', code_verifier: 'ver', return_to: '#/playlist/p1/confirm', expires_at: later(60e3), ...extra });
const google = () => (url) => {
  if (url.includes('oauth2.googleapis.com/token')) {
    return { body: { access_token: 'acc', refresh_token: 'ref', expires_in: 3600, scope: 'https://www.googleapis.com/auth/youtube' } };
  }
  if (url.includes('/channels')) return { body: { items: [{ snippet: { title: 'わたしのチャンネル' } }] } };
  throw new Error('unexpected ' + url);
};
const back = (qs) => new Request(`https://fn/cb?${qs}`, { method: 'GET' });
const locationOf = (res) => res.headers.get('Location');

test('callback：鍵は youtube_connections ではなく保留に置き、アプリの確定の画面へ戻す', async () => {
  const { deps, db } = makeDeps({ env, tables: { oauth_states: [state()] }, fetchMap: google() });
  const res = await callback(back('state=S1&code=C'), deps);
  assert.equal(res.status, 302);
  assert.equal(db.tables.youtube_connections?.length ?? 0, 0);
  assert.equal(db.tables.youtube_pending.length, 1);
  const p = db.tables.youtube_pending[0];
  assert.equal(p.user_id, 'u1');
  assert.equal(p.channel_title, 'わたしのチャンネル');
  assert.equal(p.return_to, '#/playlist/p1/confirm');
  assert.equal(await decrypt(p.refresh_token_enc, KEY), 'ref');
  assert.ok(p.id.length >= 40, '保留の id は推測できない長さ');
  assert.ok(Date.parse(p.expires_at) > NOW.getTime());
  assert.equal(locationOf(res), `${APP}/#/settings?yt=finish&p=${encodeURIComponent(p.id)}`);
  assert.equal(db.tables.oauth_states.length, 0, 'state は一度きり');
});

test('callback：state が無効なら、何も置かずに設定の画面へ（error）', async () => {
  const { deps, db } = makeDeps({ env, tables: { oauth_states: [] }, fetchMap: google() });
  const res = await callback(back('state=NO&code=C'), deps);
  assert.equal(locationOf(res), `${APP}/#/settings?yt=error`);
  assert.equal(db.tables.youtube_pending?.length ?? 0, 0);
});

const pending = (extra = {}) => ({
  id: 'P1', user_id: 'u1', channel_title: 'わたしのチャンネル', refresh_token_enc: 'R', access_token_enc: 'A',
  access_expires_at: later(3600e3), return_to: '#/playlist/p1/confirm', expires_at: later(60e3), ...extra,
});

test('finish：同じ人なら youtube_connections に保存し、保留を消して、戻り先を返す', async () => {
  const { deps, db } = makeDeps({ env, tables: { youtube_pending: [pending()] } });
  const res = await finish(post({ pendingId: 'P1' }), deps);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { returnTo: '#/playlist/p1/confirm', channelTitle: 'わたしのチャンネル' });
  assert.equal(db.tables.youtube_pending.length, 0);
  const c = db.tables.youtube_connections[0];
  assert.equal(c.user_id, 'u1');
  assert.equal(c.refresh_token_enc, 'R');
  assert.equal(c.access_token_enc, 'A');
  assert.equal(c.connected_at, NOW.toISOString());
});

test('finish：別の人が始めた保留は保存しない（WRONG_USER）。保留は消す', async () => {
  const { deps, db } = makeDeps({ env, tables: { youtube_pending: [pending({ user_id: 'someone-else' })] } });
  const res = await finish(post({ pendingId: 'P1' }), deps);
  assert.equal(res.status, 403);
  assert.equal((await res.json()).error.code, 'WRONG_USER');
  assert.equal(db.tables.youtube_connections?.length ?? 0, 0);
  assert.equal(db.tables.youtube_pending.length, 0);
});

test('finish：期限の切れた保留は保存しない（EXPIRED）', async () => {
  const { deps, db } = makeDeps({ env, tables: { youtube_pending: [pending({ expires_at: later(-1) })] } });
  const res = await finish(post({ pendingId: 'P1' }), deps);
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error.code, 'EXPIRED');
  assert.equal(db.tables.youtube_connections?.length ?? 0, 0);
});

test('finish：ない保留・pendingId なし・ログインなし・招待されていない人は弾く', async () => {
  const { deps } = makeDeps({ env, tables: { youtube_pending: [pending()] } });
  assert.equal((await finish(post({ pendingId: 'NONE' }), deps)).status, 404);
  assert.equal((await finish(post({}), deps)).status, 400);
  assert.equal((await finish(post({ pendingId: 'P1' }, { jwt: null }), deps)).status, 401);
  const { deps: d2, db } = makeDeps({ env, allowed: false, tables: { youtube_pending: [pending()] } });
  assert.equal((await finish(post({ pendingId: 'P1' }), d2)).status, 403);
  assert.equal(db.tables.youtube_connections?.length ?? 0, 0);
});

test('finish：戻り先がおかしければ設定の画面に戻す', async () => {
  const { deps } = makeDeps({ env, tables: { youtube_pending: [pending({ return_to: 'https://evil.example/' })] } });
  const j = await (await finish(post({ pendingId: 'P1' }), deps)).json();
  assert.equal(j.returnTo, '#/settings');
});
