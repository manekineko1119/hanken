import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handle } from '../../supabase/functions/yt-save-playlist/handler.js';
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

test('2回目：今の項目を全部消してから入れ直す', async () => {
  const router = happy((url, init) => {
    const m = init.method ?? 'GET';
    if (url.includes('/playlistItems') && m === 'GET') return ok({ items: [{ id: 'i1' }, { id: 'i2' }] });
    if (url.includes('/playlistItems') && m === 'DELETE') return { status: 204, body: null };
    return null;
  });
  const { deps, reqs, db } = await setup({ tracks: [trk(1), trk(2)], playlist: { youtube_playlist_id: 'OLD', status: 'saved' }, router });
  const j = await (await call(deps)).json();
  assert.deepEqual(yt(reqs), ['GET playlistItems', 'DELETE playlistItems', 'DELETE playlistItems', 'POST playlistItems', 'POST playlistItems']);
  assert.equal(new URL(reqs[0].url).searchParams.get('playlistId'), 'OLD');
  assert.deepEqual(reqs.slice(1, 3).map((r) => new URL(r.url).searchParams.get('id')), ['i1', 'i2']);
  assert.equal(reqs[3].body.snippet.playlistId, 'OLD');
  assert.equal(j.youtubePlaylistId, 'OLD');
  assert.equal(j.inserted, 2);
  // 1 + 50×2 + 50×2 = 201（見積もりと同じ）
  assert.equal(db.tables.api_usage[0].units, 201);
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
  const { deps, reqs } = await setup({ tracks: [trk(1)], playlist: { youtube_playlist_id: 'OLD' }, router });
  await call(deps);
  assert.deepEqual(yt(reqs), ['GET playlistItems', 'GET playlistItems', 'DELETE playlistItems', 'DELETE playlistItems', 'POST playlistItems']);
});

test('YouTube 側で消されていた（404）：新しく作る', async () => {
  const router = happy((url, init) => {
    if (url.includes('/playlistItems') && (init.method ?? 'GET') === 'GET') return { status: 404, body: { error: { message: 'x' } } };
    return null;
  });
  const { deps, reqs, db } = await setup({ tracks: [trk(1)], playlist: { youtube_playlist_id: 'GONE', status: 'saved' }, router });
  const j = await (await call(deps)).json();
  assert.deepEqual(yt(reqs), ['GET playlistItems', 'POST playlists', 'POST playlistItems']);
  assert.equal(j.youtubePlaylistId, 'NEWPL');
  assert.equal(db.tables.playlists[0].youtube_playlist_id, 'NEWPL');
  // 1（list）+ 50（作成）+ 50（追加）
  assert.equal(db.tables.api_usage[0].units, 101);
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
    tracks: [trk(1)], playlist: { youtube_playlist_id: 'OLD', status: 'saved' }, router,
    tables: { api_usage: [{ day_pt: '2026-11-16', units: 9300, searches: 0 }] },
  });
  const res = await call(deps);
  assert.equal(res.status, 429);
  assert.equal((await res.json()).error.code, 'QUOTA');
  assert.deepEqual(yt(reqs), ['GET playlistItems']);
  assert.equal(db.tables.api_usage[0].units, 9301); // list の1単位だけ残る
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
  const { deps, db } = await setup({ tracks: [trk(1)], playlist: { youtube_playlist_id: 'OLD' }, router });
  assert.equal((await call(deps)).status, 200);
  assert.equal(db.tables.api_usage[0].units, 1 + 150 + 50);
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
