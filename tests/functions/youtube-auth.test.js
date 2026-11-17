import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handle as start } from '../../supabase/functions/yt-connect-start/handler.js';
import { handle as callback } from '../../supabase/functions/yt-connect-callback/handler.js';
import { handle as disconnect } from '../../supabase/functions/yt-disconnect/handler.js';
import { getAccessToken } from '../../supabase/functions/_shared/youtube-auth.js';
import { encrypt, decrypt } from '../../supabase/functions/_shared/crypto.js';
import { post, NOW } from './helpers.js';

const KEY = Buffer.alloc(32, 7).toString('base64');
const ENV = {
  YT_CLIENT_ID: 'cid',
  YT_CLIENT_SECRET: 'csecret',
  YT_TOKEN_KEY: KEY,
  YT_REDIRECT_URI: 'http://127.0.0.1:55321/functions/v1/yt-connect-callback',
  APP_ORIGIN: 'http://localhost:8080',
};
const YT = 'https://www.googleapis.com/auth/youtube';
const iso = (ms) => new Date(NOW.getTime() + ms).toISOString();

// start / callback / disconnect が使う呼び出しだけを持つ偽 db。
function makeDb(tables = {}, errors = {}) {
  const t = { allowed_emails: [{ email: 'me@example.com' }], ...tables };
  const rows = (n) => (t[n] ??= []);
  return {
    t,
    auth: {
      async getUser(jwt) {
        return jwt === 'goodjwt'
          ? { data: { user: { id: 'u1', email: 'me@example.com' } }, error: null }
          : { data: { user: null }, error: { message: 'x' } };
      },
    },
    from(table) {
      const fail = errors[table] ? { error: errors[table] } : null;
      return {
        select() {
          return {
            eq(c, v) {
              return { async maybeSingle() { return { data: rows(table).find((r) => r[c] === v) ?? null, error: errors[table] ?? null }; } };
            },
          };
        },
        async insert(row) {
          if (fail) return fail;
          rows(table).push({ ...row });
          return { error: null };
        },
        async upsert(row, opts) {
          if (fail) return fail;
          const k = opts?.onConflict;
          const i = rows(table).findIndex((r) => r[k] === row[k]);
          if (i >= 0) rows(table)[i] = { ...row }; else rows(table).push({ ...row });
          return { error: null };
        },
        update(patch) {
          return {
            async eq(c, v) {
              if (fail) return fail;
              rows(table).filter((r) => r[c] === v).forEach((r) => Object.assign(r, patch));
              return { error: null };
            },
          };
        },
        delete() {
          return {
            async eq(c, v) {
              if (fail) return fail;
              t[table] = rows(table).filter((r) => r[c] !== v);
              return { error: null };
            },
          };
        },
      };
    },
  };
}

// map: URL の先頭が合うものを返す。{ status, body } か、throw する関数。
function makeFetch(map) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    const u = String(url);
    calls.push({ url: u, init, body: init.body ? new URLSearchParams(String(init.body)) : null });
    const key = Object.keys(map).find((k) => u.startsWith(k));
    if (!key) throw new Error(`unexpected fetch ${u}`);
    const r = typeof map[key] === 'function' ? await map[key](u, init) : map[key];
    return { ok: (r.status ?? 200) < 400, status: r.status ?? 200, json: async () => r.body };
  };
  return { fetch, calls };
}

const mk = (db, fetchMap = {}) => {
  const f = makeFetch(fetchMap);
  return { deps: { fetch: f.fetch, db, env: (k) => ENV[k], now: () => NOW }, calls: f.calls };
};
const cbReq = (qs) => new Request(`http://fn/yt-connect-callback?${qs}`, { method: 'GET' });
const stateRow = (o = {}) => ({ state: 'st1', user_id: 'u1', code_verifier: 'ver123', return_to: '#/playlist/p1?confirm=1', expires_at: iso(5 * 60000), ...o });
const goodToken = { access_token: 'at1', refresh_token: 'rt1', expires_in: 3600, scope: `openid ${YT}` };
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const CHANNELS_URL = 'https://www.googleapis.com/youtube/v3/channels';
const googleOk = {
  [TOKEN_URL]: { body: goodToken },
  [CHANNELS_URL]: { body: { items: [{ snippet: { title: 'My Channel' } }] } },
};
const loc = (res) => res.headers.get('Location');
const ERR = 'http://localhost:8080/#/settings?yt=error';

// ---- yt-connect-start ----
test('start: ログインなしは 401、returnTo が不正なら 400 で state を作らない', async () => {
  const db = makeDb();
  const { deps } = mk(db);
  assert.equal((await start(post({ returnTo: '#/x' }, { jwt: null }), deps)).status, 401);
  for (const returnTo of ['https://evil.example', '//evil', '#//evil', undefined, 5]) {
    const res = await start(post({ returnTo }), deps);
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error.code, 'BAD_INPUT');
  }
  assert.equal(db.t.oauth_states, undefined);
});

test('start: state・PKCE を10分で保存し、offline・consent・youtube の URL を返す', async () => {
  const db = makeDb();
  const { deps } = mk(db);
  const res = await start(post({ returnTo: '#/playlist/p1?confirm=1' }), deps);
  assert.equal(res.status, 200);
  const { url } = await res.json();
  const u = new URL(url);
  assert.equal(`${u.origin}${u.pathname}`, 'https://accounts.google.com/o/oauth2/v2/auth');
  const q = u.searchParams;
  assert.equal(q.get('client_id'), 'cid');
  assert.equal(q.get('redirect_uri'), ENV.YT_REDIRECT_URI);
  assert.equal(q.get('response_type'), 'code');
  assert.equal(q.get('scope'), YT);
  assert.equal(q.get('access_type'), 'offline');
  assert.equal(q.get('prompt'), 'consent');
  assert.equal(q.get('code_challenge_method'), 'S256');
  const row = db.t.oauth_states[0];
  assert.equal(q.get('state'), row.state);
  assert.equal(row.user_id, 'u1');
  assert.equal(row.return_to, '#/playlist/p1?confirm=1');
  assert.equal(row.expires_at, iso(10 * 60000));
  const challenge = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(row.code_verifier))).toString('base64url');
  assert.equal(q.get('code_challenge'), challenge);
  assert.ok(row.state.length >= 32 && row.code_verifier.length >= 43);
});

test('start: 設定が足りない・保存に失敗したら 502 UPSTREAM', async () => {
  const noEnv = mk(makeDb());
  noEnv.deps.env = (k) => (k === 'YT_CLIENT_ID' ? undefined : ENV[k]);
  assert.equal((await start(post({ returnTo: '#/x' }), noEnv.deps)).status, 502);
  const bad = mk(makeDb({}, { oauth_states: { message: 'boom' } }));
  const res = await start(post({ returnTo: '#/x' }), bad.deps);
  assert.equal(res.status, 502);
  assert.equal((await res.json()).error.code, 'UPSTREAM');
});

// ---- yt-connect-callback ----
test('callback: 成功で暗号化して保存し、state を消して returnTo へ 302', async () => {
  const db = makeDb({ oauth_states: [stateRow()] });
  const { deps, calls } = mk(db, googleOk);
  const res = await callback(cbReq('code=abc&state=st1'), deps);
  assert.equal(res.status, 302);
  assert.equal(loc(res), 'http://localhost:8080/#/playlist/p1?confirm=1');
  assert.equal(db.t.oauth_states.length, 0);
  const row = db.t.youtube_connections[0];
  assert.equal(row.user_id, 'u1');
  assert.equal(row.channel_title, 'My Channel');
  assert.ok(!JSON.stringify(row).includes('rt1') && !JSON.stringify(row).includes('at1'));
  assert.equal(await decrypt(row.refresh_token_enc, KEY), 'rt1');
  assert.equal(await decrypt(row.access_token_enc, KEY), 'at1');
  assert.equal(row.access_expires_at, iso(3600 * 1000));
  assert.equal(row.connected_at, NOW.toISOString());
  const tok = calls[0].body;
  assert.equal(tok.get('grant_type'), 'authorization_code');
  assert.equal(tok.get('code'), 'abc');
  assert.equal(tok.get('code_verifier'), 'ver123');
  assert.equal(tok.get('client_secret'), 'csecret');
  assert.equal(tok.get('redirect_uri'), ENV.YT_REDIRECT_URI);
  assert.equal(calls[1].init.headers.Authorization, 'Bearer at1');
  assert.ok(calls[1].url.includes('mine=true'));
});

test('callback: state がない・知らない・期限切れは error へ（Google は呼ばない）', async () => {
  for (const [qs, rows] of [
    ['code=abc', []],
    ['code=abc&state=zzz', [stateRow()]],
    ['code=abc&state=st1', [stateRow({ expires_at: iso(-1000) })]],
  ]) {
    const db = makeDb({ oauth_states: rows });
    const { deps, calls } = mk(db, googleOk);
    const res = await callback(cbReq(qs), deps);
    assert.equal(res.status, 302);
    assert.equal(loc(res), ERR);
    assert.equal(calls.length, 0);
    assert.equal(db.t.youtube_connections, undefined);
  }
});

test('callback: 期限切れの state の行は消す', async () => {
  const db = makeDb({ oauth_states: [stateRow({ expires_at: iso(-1000) })] });
  await callback(cbReq('code=abc&state=st1'), mk(db, googleOk).deps);
  assert.equal(db.t.oauth_states.length, 0);
});

test('callback: Google が error を返した・code がない → error。state は消す', async () => {
  for (const qs of ['error=access_denied&state=st1', 'state=st1']) {
    const db = makeDb({ oauth_states: [stateRow()] });
    const { deps, calls } = mk(db, googleOk);
    const res = await callback(cbReq(qs), deps);
    assert.equal(loc(res), ERR);
    assert.equal(calls.length, 0);
    assert.equal(db.t.oauth_states.length, 0);
  }
});

test('callback: scope に youtube がなければ、鍵を保存せず yt=noscope', async () => {
  const db = makeDb({ oauth_states: [stateRow()] });
  const { deps } = mk(db, { ...googleOk, [TOKEN_URL]: { body: { ...goodToken, scope: 'openid email profile' } } });
  const res = await callback(cbReq('code=abc&state=st1'), deps);
  assert.equal(loc(res), 'http://localhost:8080/#/settings?yt=noscope');
  assert.equal(db.t.youtube_connections, undefined);
  assert.equal(db.t.oauth_states.length, 0);
});

test('callback: トークン交換の失敗・refresh_token なし・チャンネル取得の失敗・保存の失敗は error', async () => {
  const cases = [
    [{ ...googleOk, [TOKEN_URL]: { status: 400, body: { error: 'invalid_grant' } } }, {}],
    [{ ...googleOk, [TOKEN_URL]: { body: { ...goodToken, refresh_token: undefined } } }, {}],
    [{ ...googleOk, [CHANNELS_URL]: { status: 403, body: {} } }, {}],
    [googleOk, { youtube_connections: { message: 'boom' } }],
  ];
  for (const [map, errors] of cases) {
    const db = makeDb({ oauth_states: [stateRow()] }, errors);
    const res = await callback(cbReq('code=abc&state=st1'), mk(db, map).deps);
    assert.equal(loc(res), ERR);
    assert.ok(!db.t.youtube_connections?.length);
  }
});

test('callback: チャンネルがなくても保存できる（名前は null）', async () => {
  const db = makeDb({ oauth_states: [stateRow()] });
  const { deps } = mk(db, { ...googleOk, [CHANNELS_URL]: { body: { items: [] } } });
  await callback(cbReq('code=abc&state=st1'), deps);
  assert.equal(db.t.youtube_connections[0].channel_title, null);
});

test('callback: 保存済みの return_to が不正なら、戻り先は使わず settings へ', async () => {
  const db = makeDb({ oauth_states: [stateRow({ return_to: 'https://evil.example/' })] });
  const res = await callback(cbReq('code=abc&state=st1'), mk(db, googleOk).deps);
  assert.equal(loc(res), 'http://localhost:8080/#/settings');
  assert.equal(db.t.youtube_connections.length, 1);
});

test('callback: GET 以外は 405', async () => {
  const { deps } = mk(makeDb());
  const res = await callback(new Request('http://fn/x', { method: 'POST' }), deps);
  assert.equal(res.status, 405);
});

// ---- getAccessToken ----
const connRow = async (o = {}) => ({
  user_id: 'u1',
  channel_title: 'c',
  refresh_token_enc: await encrypt('rt1', KEY),
  access_token_enc: await encrypt('old-at', KEY),
  access_expires_at: iso(-1000),
  connected_at: iso(-86400000),
  ...o,
});

test('getAccessToken: 有効ならそのまま返し、Google は呼ばない', async () => {
  const db = makeDb({ youtube_connections: [await connRow({ access_expires_at: iso(10 * 60000) })] });
  const { deps, calls } = mk(db);
  assert.equal(await getAccessToken(db, 'u1', deps), 'old-at');
  assert.equal(calls.length, 0);
});

test('getAccessToken: 切れていたら更新して暗号化して保存する', async () => {
  const db = makeDb({ youtube_connections: [await connRow()] });
  const { deps, calls } = mk(db, { [TOKEN_URL]: { body: { access_token: 'new-at', expires_in: 3600 } } });
  assert.equal(await getAccessToken(db, 'u1', deps), 'new-at');
  assert.equal(calls[0].body.get('grant_type'), 'refresh_token');
  assert.equal(calls[0].body.get('refresh_token'), 'rt1');
  const row = db.t.youtube_connections[0];
  assert.equal(await decrypt(row.access_token_enc, KEY), 'new-at');
  assert.equal(await decrypt(row.refresh_token_enc, KEY), 'rt1');
  assert.equal(row.access_expires_at, iso(3600 * 1000));
});

test('getAccessToken: invalid_grant なら行を消して YT_RECONNECT', async () => {
  const db = makeDb({ youtube_connections: [await connRow()] });
  const { deps } = mk(db, { [TOKEN_URL]: { status: 400, body: { error: 'invalid_grant' } } });
  await assert.rejects(getAccessToken(db, 'u1', deps), (e) => e.code === 'YT_RECONNECT');
  assert.equal(db.t.youtube_connections.length, 0);
});

test('getAccessToken: つながっていなければ YT_RECONNECT。ほかの失敗は UPSTREAM で行は残す', async () => {
  const none = makeDb();
  await assert.rejects(getAccessToken(none, 'u1', mk(none).deps), (e) => e.code === 'YT_RECONNECT');
  const db = makeDb({ youtube_connections: [await connRow()] });
  const { deps } = mk(db, { [TOKEN_URL]: { status: 500, body: { error: 'backend_error' } } });
  await assert.rejects(getAccessToken(db, 'u1', deps), (e) => e.code === 'UPSTREAM');
  assert.equal(db.t.youtube_connections.length, 1);
});

// ---- yt-disconnect ----
const REVOKE = 'https://oauth2.googleapis.com/revoke';

test('disconnect: revoke して行を消す', async () => {
  const db = makeDb({ youtube_connections: [await connRow()] });
  const { deps, calls } = mk(db, { [REVOKE]: { body: {} } });
  const res = await disconnect(post({}), deps);
  assert.deepEqual(await res.json(), { ok: true });
  assert.equal(calls[0].body.get('token'), 'rt1');
  assert.equal(db.t.youtube_connections.length, 0);
});

test('disconnect: revoke が失敗（HTTP エラー・通信エラー）しても行は消す', async () => {
  for (const map of [{ [REVOKE]: { status: 400, body: {} } }, { [REVOKE]: () => { throw new Error('net'); } }]) {
    const db = makeDb({ youtube_connections: [await connRow()] });
    const res = await disconnect(post({}), mk(db, map).deps);
    assert.deepEqual(await res.json(), { ok: true });
    assert.equal(db.t.youtube_connections.length, 0);
  }
});

test('disconnect: 鍵が壊れていても行は消す。つながっていなくても ok。未ログインは 401', async () => {
  const db = makeDb({ youtube_connections: [await connRow({ refresh_token_enc: 'broken', access_token_enc: null })] });
  const { deps, calls } = mk(db);
  assert.deepEqual(await (await disconnect(post({}), deps)).json(), { ok: true });
  assert.equal(db.t.youtube_connections.length, 0);
  assert.equal(calls.length, 0);
  const empty = mk(makeDb());
  assert.deepEqual(await (await disconnect(post({}), empty.deps)).json(), { ok: true });
  assert.equal((await disconnect(post({}, { jwt: null }), empty.deps)).status, 401);
});

test('disconnect: 行の削除に失敗したら 502（消えたと言わない）', async () => {
  const db = makeDb({ youtube_connections: [await connRow()] });
  const orig = db.from;
  db.from = (t) => (t === 'youtube_connections'
    ? { ...orig(t), delete: () => ({ eq: async () => ({ error: { message: 'x' } }) }) }
    : orig(t));
  const res = await disconnect(post({}), mk(db, { [REVOKE]: { body: {} } }).deps);
  assert.equal(res.status, 502);
});
