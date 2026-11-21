import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handle, MAX_TRACKS } from '../../supabase/functions/yt-save-playlist/handler.js';
import { encrypt } from '../../supabase/functions/_shared/crypto.js';
import { makeDeps, post, NOW } from './helpers.js';

const PL = 'p1';
const KEY = Buffer.alloc(32, 7).toString('base64');
const env = { YT_TOKEN_KEY: KEY, YT_CLIENT_ID: 'cid', YT_CLIENT_SECRET: 'cs' };
const trk = (n, video) => ({ id: 't' + n, playlist_id: PL, position: n, title: '曲' + n, artist_name: 'バンドA', video_id: video === undefined ? 'v' + n : video });
const conn = async () => ({
  user_id: 'u1',
  refresh_token_enc: await encrypt('refresh', KEY),
  access_token_enc: await encrypt('access-tok', KEY),
  access_expires_at: new Date(NOW.getTime() + 3600e3).toISOString(),
});
const setup = async ({ tracks, playlist = {}, router, tables = {} } = {}) =>
  makeDeps({
    env,
    tables: {
      playlists: [{ id: PL, user_id: 'u1', title: '予習', status: 'draft', youtube_playlist_id: null, saved_at: null, ...playlist }],
      playlist_tracks: tracks,
      youtube_connections: [await conn()],
      ...tables,
    },
    fetchMap: router,
  });
const ok = (body = {}) => ({ body });
const yt = (reqs) => reqs.map((r) => `${r.method} ${new URL(r.url).pathname.replace('/youtube/v3/', '')}`);
// 既定の YouTube：作成と追加は成功。extra で上書きできる。
const happy = (extra = () => null) => (url, init = {}) => {
  const e = extra(url, init);
  if (e) return e;
  const m = init.method ?? 'GET';
  if (url.includes('/playlists') && m === 'POST') return ok({ id: 'NEWPL' });
  if (url.includes('/playlists') && m === 'GET') return ok({ items: [{ id: new URL(url).searchParams.get('id'), status: { privacyStatus: 'private' } }] });
  if (url.includes('/playlistItems') && m === 'POST') return ok({ id: 'item' });
  throw new Error('unexpected ' + m + ' ' + url);
};
const videoOf = (init) => JSON.parse(init.body).snippet.resourceId.videoId;
const call = (deps, body = { playlistId: PL, title: '半券：バンドA' }) => handle(post(body), deps);

test('新しく作る：private で作り、video_id のある曲だけを順に入れ、保存済みにする', async () => {
  const { deps, reqs, db } = await setup({ tracks: [trk(1), trk(2, null), trk(3)], router: happy() });
  const res = await call(deps);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), {
    youtubePlaylistId: 'NEWPL', url: 'https://music.youtube.com/playlist?list=NEWPL', inserted: 2, skipped: 1,
  });
  assert.deepEqual(yt(reqs), ['POST playlists', 'POST playlistItems', 'POST playlistItems']);
  const create = reqs[0];
  assert.equal(new URL(create.url).searchParams.get('part'), 'snippet,status');
  assert.equal(create.body.status.privacyStatus, 'private');
  assert.equal(create.body.snippet.title, '半券：バンドA');
  assert.equal(create.headers.Authorization, 'Bearer access-tok');
  assert.deepEqual(reqs.slice(1).map((r) => r.body.snippet.resourceId.videoId), ['v1', 'v3']);
  assert.equal(reqs[1].body.snippet.playlistId, 'NEWPL');
  const p = db.tables.playlists[0];
  assert.equal(p.status, 'saved');
  assert.equal(p.youtube_playlist_id, 'NEWPL');
  assert.equal(p.saved_at, NOW.toISOString());
  // 単位：50 + 50×2 = 150。本人の回数は1
  assert.equal(db.tables.api_usage[0].units, 150);
  assert.equal(db.tables.api_usage[0].day_pt, '2026-11-16');
  assert.equal(db.tables.api_usage[0].searches, 0);
  const u = db.tables.user_daily_usage.find((r) => r.kind === 'save');
  assert.equal(u.count, 1);
  assert.equal(u.day_jst, '2026-11-17');
});

test('2回目：非公開かを確かめ、新しい曲を全部入れてから前の項目を消す', async () => {
  const router = happy((url, init) => {
    const m = init.method ?? 'GET';
    if (url.includes('/playlistItems') && m === 'GET') return ok({ items: [{ id: 'i1' }, { id: 'i2' }] });
    if (url.includes('/playlistItems') && m === 'DELETE') return { status: 204, body: null };
    return null;
  });
  const { deps, reqs, db } = await setup({ tracks: [trk(1), trk(2)], playlist: { youtube_playlist_id: 'OLD', status: 'saved', title: '半券：バンドA' }, router });
  const j = await (await call(deps)).json();
  assert.deepEqual(yt(reqs), ['GET playlists', 'GET playlistItems', 'POST playlistItems', 'POST playlistItems', 'DELETE playlistItems', 'DELETE playlistItems']);
  assert.equal(new URL(reqs[0].url).searchParams.get('part'), 'status');
  assert.equal(new URL(reqs[0].url).searchParams.get('id'), 'OLD');
  assert.equal(new URL(reqs[1].url).searchParams.get('playlistId'), 'OLD');
  assert.equal(reqs[2].body.snippet.playlistId, 'OLD');
  assert.deepEqual(reqs.slice(4).map((r) => new URL(r.url).searchParams.get('id')), ['i1', 'i2']);
  assert.equal(j.youtubePlaylistId, 'OLD');
  assert.equal(j.inserted, 2);
  // 確かめ 1 + list 1 + 50×2 + 50×2 = 202（見積もりと同じ）
  assert.equal(db.tables.api_usage[0].units, 202);
});

test('作り直しの途中で追加が失敗しても、前の曲は消さない（空のプレイリストにしない）。回数は戻す', async () => {
  const router = happy((url, init) => {
    const m = init.method ?? 'GET';
    if (url.includes('/playlistItems') && m === 'GET') return ok({ items: [{ id: 'i1' }] });
    if (url.includes('/playlistItems') && m === 'POST' && videoOf(init) === 'v2') return { status: 500, body: {} };
    if (url.includes('/playlistItems') && m === 'DELETE') return { status: 204, body: null };
    return null;
  });
  const { deps, reqs, db } = await setup({ tracks: [trk(1), trk(2)], playlist: { youtube_playlist_id: 'OLD', status: 'saved', title: '半券：バンドA' }, router });
  const res = await call(deps);
  assert.equal(res.status, 502);
  assert.ok(!yt(reqs).includes('DELETE playlistItems'));
  assert.equal(db.tables.user_daily_usage.find((r) => r.kind === 'save').count, 0);
});

test('作り直し：YouTube で公開・限定公開に変えられていたら、何も変えずに NOT_PRIVATE（回数は数える）', async () => {
  for (const privacyStatus of ['public', 'unlisted']) {
    const router = happy((url, init) => {
      if (url.includes('/playlists') && (init.method ?? 'GET') === 'GET') return ok({ items: [{ id: 'OLD', status: { privacyStatus } }] });
      return null;
    });
    const { deps, reqs, db } = await setup({ tracks: [trk(1)], playlist: { youtube_playlist_id: 'OLD', status: 'saved', title: '半券：バンドA' }, router });
    const res = await call(deps);
    assert.equal(res.status, 409);
    const j = await res.json();
    assert.equal(j.error.code, 'NOT_PRIVATE');
    assert.match(j.error.message, /非公開に戻して/);
    assert.deepEqual(yt(reqs), ['GET playlists']);
    assert.equal(db.tables.api_usage[0].units, 1);
    assert.equal(db.tables.user_daily_usage.find((r) => r.kind === 'save').count, 1);
  }
});

test('作り直し：全員の枠が残り少なければ、確かめの呼び出しもせずに QUOTA（回数は戻す）', async () => {
  const { deps, reqs, db } = await setup({
    tracks: [trk(1)], playlist: { youtube_playlist_id: 'OLD', status: 'saved', title: '半券：バンドA' }, router: happy(),
    tables: { api_usage: [{ day_pt: '2026-11-16', units: 9499, searches: 0 }] },
  });
  const res = await call(deps);
  assert.equal(res.status, 429);
  assert.equal(reqs.length, 0);
  assert.equal(db.tables.api_usage[0].units, 9499);
  assert.equal(db.tables.user_daily_usage.find((r) => r.kind === 'save').count, 0);
});

test('作り直し：公開の状態を確かめられなければ、何も変えずに止まる', async () => {
  const router = happy((url, init) => (url.includes('/playlists') && (init.method ?? 'GET') === 'GET' ? { status: 500, body: {} } : null));
  const { deps, reqs } = await setup({ tracks: [trk(1)], playlist: { youtube_playlist_id: 'OLD', status: 'saved', title: '半券：バンドA' }, router });
  const res = await call(deps);
  assert.equal(res.status, 502);
  assert.deepEqual(yt(reqs), ['GET playlists']);
});

test('YouTube 側で消されていた（playlists.list が空）：新しく作る', async () => {
  const router = happy((url, init) => (url.includes('/playlists') && (init.method ?? 'GET') === 'GET' ? ok({ items: [] }) : null));
  const { deps, reqs, db } = await setup({ tracks: [trk(1)], playlist: { youtube_playlist_id: 'GONE', status: 'saved' }, router });
  const j = await (await call(deps)).json();
  assert.deepEqual(yt(reqs), ['GET playlists', 'POST playlists', 'POST playlistItems']);
  assert.equal(j.youtubePlaylistId, 'NEWPL');
});

test(`1回に入れる曲は ${MAX_TRACKS} 曲まで（超えたら何も使わずに BAD_INPUT）`, async () => {
  const many = Array.from({ length: MAX_TRACKS + 1 }, (_, i) => trk(i + 1));
  const { deps, reqs, db } = await setup({ tracks: many, router: happy() });
  const res = await call(deps);
  assert.equal(res.status, 400);
  assert.match((await res.json()).error.message, new RegExp(`${MAX_TRACKS}曲まで`));
  assert.equal(reqs.length, 0);
  assert.equal(db.rpcCalls.length, 0);
  const { deps: d2 } = await setup({ tracks: many.slice(0, MAX_TRACKS), router: happy() });
  assert.equal((await call(d2)).status, 200);
});

test('項目が50件を超えるときは、次のページも取って消す', async () => {
  const router = happy((url, init) => {
    const m = init.method ?? 'GET';
    if (url.includes('/playlistItems') && m === 'GET') {
      return new URL(url).searchParams.get('pageToken') ? ok({ items: [{ id: 'i2' }] }) : ok({ items: [{ id: 'i1' }], nextPageToken: 'NP' });
    }
    if (m === 'DELETE') return { status: 204, body: null };
    return null;
  });
  const { deps, reqs } = await setup({ tracks: [trk(1)], playlist: { youtube_playlist_id: 'OLD', title: '半券：バンドA' }, router });
  await call(deps);
  assert.deepEqual(yt(reqs), ['GET playlists', 'GET playlistItems', 'GET playlistItems', 'POST playlistItems', 'DELETE playlistItems', 'DELETE playlistItems']);
});

test('YouTube 側で消されていた（playlistItems が 404）：新しく作る', async () => {
  const router = happy((url, init) => {
    if (url.includes('/playlistItems') && (init.method ?? 'GET') === 'GET') return { status: 404, body: { error: { message: 'x' } } };
    return null;
  });
  const { deps, reqs, db } = await setup({ tracks: [trk(1)], playlist: { youtube_playlist_id: 'GONE', status: 'saved' }, router });
  const j = await (await call(deps)).json();
  assert.deepEqual(yt(reqs), ['GET playlists', 'GET playlistItems', 'POST playlists', 'POST playlistItems']);
  assert.equal(j.youtubePlaylistId, 'NEWPL');
  assert.equal(db.tables.playlists[0].youtube_playlist_id, 'NEWPL');
  // 1（確かめ）+ 1（list）+ 50（作成）+ 50（追加）
  assert.equal(db.tables.api_usage[0].units, 102);
});

test('追加で動画が見つからない（404）曲は飛ばして続ける', async () => {
  const router = happy((url, init) => {
    if (url.includes('/playlistItems') && init.method === 'POST' && videoOf(init) === 'v2') {
      return { status: 404, body: { error: { errors: [{ reason: 'videoNotFound' }] } } };
    }
    return null;
  });
  const { deps, db } = await setup({ tracks: [trk(1), trk(2), trk(3)], router });
  const j = await (await call(deps)).json();
  assert.equal(j.inserted, 2);
  assert.equal(j.skipped, 1);
  assert.equal(db.tables.playlists[0].status, 'saved');
  assert.equal(db.tables.api_usage[0].units, 200); // 50 + 3×50（失敗した呼び出しも数える）
});

test('途中で失敗：使った単位が残り、エラーに inserted が入る。作った ID は残して、次は作り直しになる', async () => {
  const router = happy((url, init) => {
    if (url.includes('/playlistItems') && init.method === 'POST' && videoOf(init) === 'v3') {
      return { status: 500, body: { error: { message: 'boom' } } };
    }
    return null;
  });
  const { deps, db } = await setup({ tracks: [trk(1), trk(2), trk(3), trk(4)], router });
  const res = await call(deps);
  assert.equal(res.status, 502);
  const j = await res.json();
  assert.equal(j.error.code, 'UPSTREAM');
  assert.equal(j.inserted, 2);
  assert.equal(db.tables.api_usage[0].units, 200); // 作成50 + 追加3回（成功2・失敗1）
  // 失敗した保存は、本人の1日の回数に数えない
  assert.equal(db.tables.user_daily_usage.find((r) => r.kind === 'save').count, 0);
  const p = db.tables.playlists[0];
  assert.equal(p.status, 'draft');
  assert.equal(p.youtube_playlist_id, 'NEWPL');
});

test('YouTube の枠が足りないと、何も呼ばずに QUOTA（回数も戻す）', async () => {
  const { deps, reqs, db } = await setup({
    tracks: [trk(1), trk(2)], router: happy(),
    tables: { api_usage: [{ day_pt: '2026-11-16', units: 9450, searches: 0 }] },
  });
  const res = await call(deps);
  assert.equal(res.status, 429);
  const j = await res.json();
  assert.equal(j.error.code, 'QUOTA');
  assert.match(j.error.message, /17時/);
  assert.ok(!j.error.message.includes('動画'));
  assert.equal(reqs.length, 0);
  assert.equal(db.tables.api_usage[0].units, 9450);
  assert.equal(db.tables.user_daily_usage.find((r) => r.kind === 'save').count, 0);
});

test('一人6回目は QUOTA（何も呼ばない）', async () => {
  const { deps, reqs, db } = await setup({
    tracks: [trk(1)], router: happy(),
    tables: { user_daily_usage: [{ user_id: 'u1', day_jst: '2026-11-17', kind: 'save', count: 5 }] },
  });
  const res = await call(deps);
  assert.equal(res.status, 429);
  assert.equal((await res.json()).error.code, 'QUOTA');
  assert.equal(reqs.length, 0);
  assert.equal(db.tables.user_daily_usage[0].count, 5);
  assert.equal(db.tables.api_usage?.[0]?.units ?? 0, 0);
});

test('一人5回目まではできる', async () => {
  const { deps } = await setup({
    tracks: [trk(1)], router: happy(),
    tables: { user_daily_usage: [{ user_id: 'u1', day_jst: '2026-11-17', kind: 'save', count: 4 }] },
  });
  assert.equal((await call(deps)).status, 200);
});

test('他人のプレイリストは保存できない（404）', async () => {
  const { deps, reqs } = await setup({ tracks: [trk(1)], playlist: { user_id: 'other' }, router: happy() });
  const res = await call(deps);
  assert.equal(res.status, 404);
  assert.equal(reqs.length, 0);
});

test('YouTube につながっていない（鍵が失効）：YT_RECONNECT。回数と単位は戻す', async () => {
  const { deps, reqs, db } = await setup({ tracks: [trk(1)], router: happy(), tables: { youtube_connections: [] } });
  const res = await call(deps);
  assert.equal(res.status, 403);
  assert.equal((await res.json()).error.code, 'YT_RECONNECT');
  assert.equal(reqs.length, 0);
  assert.equal(db.tables.api_usage?.[0]?.units ?? 0, 0);
  assert.equal(db.tables.user_daily_usage.find((r) => r.kind === 'save').count, 0);
});

test('入れる曲が1つもないと BAD_INPUT（何も使わない）', async () => {
  const { deps, reqs, db } = await setup({ tracks: [trk(1, null)], router: happy() });
  const res = await call(deps);
  assert.equal(res.status, 400);
  assert.equal(reqs.length, 0);
  assert.equal(db.rpcCalls.length, 0);
});

test('playlistId がない・ログインなしは弾く', async () => {
  const { deps } = await setup({ tracks: [], router: happy() });
  assert.equal((await handle(post({ title: 'x' }), deps)).status, 400);
  assert.equal((await handle(post({ playlistId: PL }, { jwt: null }), deps)).status, 401);
});

test('title を渡さなければ、プレイリストの題名を使う', async () => {
  const { deps, reqs } = await setup({ tracks: [trk(1)], router: happy() });
  await call(deps, { playlistId: PL });
  assert.equal(reqs[0].body.snippet.title, '予習');
});

test('作り直し：YouTube に残っている本当の項目数で枠を確かめ、足りなければ消さずに QUOTA', async () => {
  const router = happy((url, init) => {
    if (url.includes('/playlistItems') && (init.method ?? 'GET') === 'GET') return ok({ items: [1, 2, 3, 4, 5].map((n) => ({ id: 'i' + n })) });
    return null;
  });
  // 下書きは1曲だけ（見積もり 101）。でも YouTube には5つ残っている（見積もり 301）。
  const { deps, reqs, db } = await setup({
    tracks: [trk(1)], playlist: { youtube_playlist_id: 'OLD', status: 'saved', title: '半券：バンドA' }, router,
    tables: { api_usage: [{ day_pt: '2026-11-16', units: 9300, searches: 0 }] },
  });
  const res = await call(deps);
  assert.equal(res.status, 429);
  assert.equal((await res.json()).error.code, 'QUOTA');
  assert.deepEqual(yt(reqs), ['GET playlists', 'GET playlistItems']);
  assert.equal(db.tables.api_usage[0].units, 9302); // 確かめと list の2単位だけ残る
  assert.equal(db.tables.user_daily_usage.find((r) => r.kind === 'save').count, 0);
  assert.equal(db.tables.playlists[0].status, 'saved');
});

test('作り直し：残りの項目が多くても、枠に入るなら消して入れ直す', async () => {
  const router = happy((url, init) => {
    const m = init.method ?? 'GET';
    if (url.includes('/playlistItems') && m === 'GET') return ok({ items: [1, 2, 3].map((n) => ({ id: 'i' + n })) });
    if (m === 'DELETE') return { status: 204, body: null };
    return null;
  });
  const { deps, db } = await setup({ tracks: [trk(1)], playlist: { youtube_playlist_id: 'OLD', title: '半券：バンドA' }, router });
  assert.equal((await call(deps)).status, 200);
  assert.equal(db.tables.api_usage[0].units, 1 + 1 + 150 + 50);
});

test('単位の予約に失敗したら、本人の回数も戻す', async () => {
  const { deps, reqs, db } = await setup({ tracks: [trk(1)], router: happy() });
  const rpc = db.rpc.bind(db);
  db.rpc = async (name, a) => (a.p_units > 0 ? { data: null, error: { message: 'boom' } } : rpc(name, a));
  const res = await call(deps);
  assert.equal(res.status, 502);
  assert.equal(reqs.length, 0);
  assert.equal(db.tables.user_daily_usage.find((r) => r.kind === 'save').count, 0);
});

test('途中で YouTube が 401 を返したら YT_RECONNECT（inserted を添える）', async () => {
  const router = happy((url, init) => {
    if (url.includes('/playlistItems') && init.method === 'POST' && videoOf(init) === 'v2') return { status: 401, body: { error: {} } };
    return null;
  });
  const { deps, db } = await setup({ tracks: [trk(1), trk(2)], router });
  const res = await call(deps);
  assert.equal(res.status, 403);
  const j = await res.json();
  assert.equal(j.error.code, 'YT_RECONNECT');
  assert.equal(j.inserted, 1);
  assert.equal(db.tables.api_usage[0].units, 150);
});

// ---- 同時保存の排他（鍵） ----
const lockOf = (db) => db.tables.playlists[0].save_locked_until;

test('保存の前に鍵を取り（YouTube を呼ぶ前）、終わったら外す', async () => {
  const { deps, db, reqs } = await setup({ tracks: [trk(1)], router: happy() });
  const f = deps.fetch;
  let claimedBeforeFirstCall = false;
  deps.fetch = async (...a) => {
    claimedBeforeFirstCall ||= db.lockCalls.some((c) => c.name === 'claim_playlist_save');
    return f(...a);
  };
  const res = await call(deps);
  assert.equal(res.status, 200);
  assert.equal(claimedBeforeFirstCall, true);
  assert.deepEqual(db.lockCalls.map((c) => c.name), ['claim_playlist_save', 'release_playlist_save']);
  assert.deepEqual(
    { id: db.lockCalls[0].p_playlist_id, user: db.lockCalls[0].p_user_id, sec: db.lockCalls[0].p_seconds },
    { id: PL, user: 'u1', sec: 120 },
  );
  assert.equal(lockOf(db), null);
  assert.ok(reqs.length > 0);
});

test('鍵が取れない（保存中）：409 BUSY。YouTube も回数も使わず、他の人の鍵は外さない', async () => {
  const locked = new Date(Date.now() + 60000).toISOString();
  const { deps, db, reqs } = await setup({ tracks: [trk(1)], playlist: { save_locked_until: locked }, router: happy() });
  const res = await call(deps);
  assert.equal(res.status, 409);
  const j = await res.json();
  assert.equal(j.error.code, 'BUSY');
  assert.equal(j.error.message, '保存中です。少し待ってからもう一度押してください');
  assert.equal(reqs.length, 0);
  assert.equal(db.tables.user_daily_usage, undefined);
  assert.deepEqual(db.lockCalls.map((c) => c.name), ['claim_playlist_save']);
  assert.equal(lockOf(db), locked);
});

test('失敗しても鍵を外す（YouTube のエラー）', async () => {
  const router = happy((url, init) => (url.includes('/playlists') && (init.method ?? 'GET') === 'POST' ? { status: 500, body: {} } : null));
  const { deps, db } = await setup({ tracks: [trk(1)], router });
  const res = await call(deps);
  assert.equal(res.status, 502);
  assert.equal(lockOf(db), null);
  assert.equal(db.lockCalls.at(-1).name, 'release_playlist_save');
});

test('鍵の取得そのものが失敗：502（YouTube は呼ばない・外す鍵もない）', async () => {
  const { deps, db, reqs } = await setup({ tracks: [trk(1)], router: happy() });
  const rpc = db.rpc.bind(db);
  db.rpc = async (name, a) => (name === 'claim_playlist_save' ? { data: null, error: { message: 'boom' } } : rpc(name, a));
  const res = await call(deps);
  assert.equal(res.status, 502);
  assert.equal(reqs.length, 0);
  assert.equal(db.lockCalls.length, 0);
});

// ---- 名前の更新・保存 ----
const existing = (extra = () => null) => happy((url, init) => {
  const m = init.method ?? 'GET';
  if (url.includes('/playlistItems') && m === 'GET') return ok({ items: [{ id: 'i1' }] });
  if (url.includes('/playlistItems') && m === 'DELETE') return { status: 204, body: null };
  if (url.includes('/playlists') && m === 'PUT') return ok({ id: 'OLD' });
  return extra(url, init);
});

test('再保存で名前が変わっていたら、YouTube の名前も更新する（part=snippet・50単位を見積もりに足す）', async () => {
  const { deps, reqs, db } = await setup({ tracks: [trk(1)], playlist: { youtube_playlist_id: 'OLD', status: 'saved', title: '前の名前' }, router: existing() });
  const res = await call(deps, { playlistId: PL, title: '新しい名前' });
  assert.equal(res.status, 200);
  assert.deepEqual(yt(reqs), ['GET playlists', 'GET playlistItems', 'PUT playlists', 'POST playlistItems', 'DELETE playlistItems']);
  const put = reqs[2];
  assert.equal(new URL(put.url).searchParams.get('part'), 'snippet');
  assert.deepEqual(put.body, { id: 'OLD', snippet: { title: '新しい名前' } });
  // 単位：確かめ 1 + list 1 + 項目1件の削除 50 + 追加 50 + 名前の更新 50 = 152
  assert.equal(db.tables.api_usage[0].units, 152);
});

test('再保存で名前が同じなら、名前の更新はしない', async () => {
  const { deps, reqs, db } = await setup({ tracks: [trk(1)], playlist: { youtube_playlist_id: 'OLD', status: 'saved', title: '同じ' }, router: existing() });
  await call(deps, { playlistId: PL, title: '同じ' });
  assert.ok(!yt(reqs).includes('PUT playlists'));
  assert.equal(db.tables.api_usage[0].units, 102);
});

test('名前の更新が失敗したら、曲を消す前に止まる（UPSTREAM）', async () => {
  const router = existing();
  const wrapped = (url, init = {}) => (url.includes('/playlists') && init.method === 'PUT' ? { status: 500, body: {} } : router(url, init));
  const { deps, reqs } = await setup({ tracks: [trk(1)], playlist: { youtube_playlist_id: 'OLD', status: 'saved', title: '前' }, router: wrapped });
  const res = await call(deps, { playlistId: PL, title: '新' });
  assert.equal(res.status, 502);
  assert.ok(!yt(reqs).includes('DELETE playlistItems'));
});

test('成功したら、実際に使った名前を playlists.title に保存する', async () => {
  const { deps, db } = await setup({ tracks: [trk(1)], router: happy() });
  await call(deps, { playlistId: PL, title: '  変えた名前  ' });
  assert.equal(db.tables.playlists[0].title, '変えた名前');
});
