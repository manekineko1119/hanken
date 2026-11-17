import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handle } from '../../supabase/functions/yt-resolve-videos/handler.js';
import { makeDeps, post, daysAgo, NOW } from './helpers.js';

const PL = 'p1';
const env = { YT_API_KEY: 'api-key' };
const trk = (id, title, extra = {}) => ({ id, playlist_id: PL, position: Number(id.slice(1)), title, artist_name: 'バンドA', ...extra });
const searchItems = (...vs) => ({ items: vs.map(([id, ch]) => ({ id: { videoId: id }, snippet: { title: 'T-' + id, channelTitle: ch } })) });
const listItems = (...ids) => ({ items: ids.map((id) => ({ id, snippet: { title: 'L-' + id } })) });
const router = ({ search = searchItems(['s1', 'ファン']), list = listItems() } = {}) => (url) => {
  if (url.includes('/youtube/v3/search')) return { body: search };
  if (url.includes('/youtube/v3/videos')) return { body: list };
  throw new Error('unexpected ' + url);
};
const base = (tracks, extra = {}) => ({
  playlists: [{ id: PL, user_id: 'u1' }],
  playlist_tracks: tracks,
  ...extra,
});
const searchCalls = (calls) => calls.filter((c) => c.includes('/youtube/v3/search'));

test('空の曲は検索して、選んだ動画を曲と video_cache に保存する', async () => {
  const { deps, calls, db } = makeDeps({
    env, tables: base([trk('t1', '曲1')]),
    fetchMap: router({ search: searchItems(['a', 'ファン'], ['b', 'バンドA - Topic']) }),
  });
  const res = await handle(post({ playlistId: PL }), deps);
  assert.equal(res.status, 200);
  const j = await res.json();
  assert.deepEqual(j.tracks, [{ id: 't1', videoId: 'b', videoTitle: 'T-b' }]);
  assert.equal(j.searchesLeft, 29);
  const url = new URL(searchCalls(calls)[0]);
  assert.equal(url.searchParams.get('q'), 'バンドA 曲1');
  assert.equal(url.searchParams.get('type'), 'video');
  assert.equal(url.searchParams.get('videoCategoryId'), '10');
  assert.equal(url.searchParams.get('maxResults'), '5');
  assert.equal(url.searchParams.get('regionCode'), 'JP');
  assert.equal(url.searchParams.get('key'), 'api-key');
  const row = db.tables.playlist_tracks[0];
  assert.equal(row.video_id, 'b');
  assert.equal(row.video_checked_at, NOW.toISOString());
  assert.equal(db.tables.video_cache[0].video_id, 'b');
  assert.equal(db.tables.api_usage[0].searches, 1);
  assert.equal(db.tables.api_usage[0].day_pt, '2026-11-16');
  assert.equal(db.tables.user_daily_usage[0].count, 1);
  assert.equal(db.tables.user_daily_usage[0].day_jst, '2026-11-17');
});

test('video_cache にある曲は検索しない', async () => {
  const { deps, calls, db } = makeDeps({
    env,
    tables: base([trk('t1', '曲1')], {
      video_cache: [{ artist_key: 'バンドa', title_key: '曲1', video_id: 'c1', video_title: 'C1', fetched_at: daysAgo(3) }],
    }),
    fetchMap: router(),
  });
  const j = await (await handle(post({ playlistId: PL }), deps)).json();
  assert.equal(calls.length, 0);
  assert.deepEqual(j.tracks, [{ id: 't1', videoId: 'c1', videoTitle: 'C1' }]);
  assert.equal(db.tables.playlist_tracks[0].video_id, 'c1');
  assert.equal(j.searchesLeft, 30);
});

test('割り当て済みで30日以内の曲は何もしない', async () => {
  const { deps, calls } = makeDeps({
    env, tables: base([trk('t1', '曲1', { video_id: 'v', video_title: 'V', video_checked_at: daysAgo(5) })]),
    fetchMap: router(),
  });
  const j = await (await handle(post({ playlistId: PL }), deps)).json();
  assert.equal(calls.length, 0);
  assert.deepEqual(j.tracks, [{ id: 't1', videoId: 'v', videoTitle: 'V' }]);
});

test('30日を過ぎた曲は videos.list だけで確かめ、消えていた曲だけ検索し直す', async () => {
  const old = { video_checked_at: daysAgo(40) };
  const { deps, calls, db } = makeDeps({
    env,
    tables: base([
      trk('t1', '曲1', { video_id: 'alive', video_title: 'old', ...old }),
      trk('t2', '曲2', { video_id: 'gone', video_title: 'x', ...old }),
    ]),
    fetchMap: router({ list: listItems('alive'), search: searchItems(['new2', 'ファン']) }),
  });
  const j = await (await handle(post({ playlistId: PL }), deps)).json();
  const listCalls = calls.filter((c) => c.includes('/youtube/v3/videos'));
  assert.equal(listCalls.length, 1);
  assert.equal(new URL(listCalls[0]).searchParams.get('id'), 'alive,gone');
  assert.equal(searchCalls(calls).length, 1);
  assert.deepEqual(j.tracks, [
    { id: 't1', videoId: 'alive', videoTitle: 'L-alive' },
    { id: 't2', videoId: 'new2', videoTitle: 'T-new2' },
  ]);
  assert.equal(db.tables.playlist_tracks[0].video_checked_at, NOW.toISOString());
  assert.equal(db.tables.api_usage[0].units, 1);
  assert.equal(db.tables.api_usage[0].searches, 1);
});

test('見つからなかった曲は videoId null で、次回は検索しない', async () => {
  const { deps, calls } = makeDeps({ env, tables: base([trk('t1', '曲1')]), fetchMap: router({ search: { items: [] } }) });
  const j = await (await handle(post({ playlistId: PL }), deps)).json();
  assert.deepEqual(j.tracks, [{ id: 't1', videoId: null, videoTitle: null }]);
  await handle(post({ playlistId: PL }), deps);
  assert.equal(searchCalls(calls).length, 1);
});

test('一人30回を超えると QUOTA', async () => {
  const { deps, calls } = makeDeps({
    env, tables: base([trk('t1', '曲1')], { user_daily_usage: [{ user_id: 'u1', day_jst: '2026-11-17', kind: 'search', count: 30 }] }),
    fetchMap: router(),
  });
  const res = await handle(post({ playlistId: PL }), deps);
  assert.equal(res.status, 429);
  assert.equal((await res.json()).error.code, 'QUOTA');
  assert.equal(calls.length, 0);
});

test('全員で90回を超えると QUOTA（太平洋時間の日付で数える）', async () => {
  const { deps, calls } = makeDeps({
    env, tables: base([trk('t1', '曲1')], { api_usage: [{ day_pt: '2026-11-16', units: 0, searches: 90 }] }),
    fetchMap: router(),
  });
  const res = await handle(post({ playlistId: PL }), deps);
  assert.equal(res.status, 429);
  assert.equal((await res.json()).error.code, 'QUOTA');
  assert.equal(calls.length, 0);
});

test('前日の枠は今日に持ち越さない', async () => {
  const { deps } = makeDeps({
    env, tables: base([trk('t1', '曲1')], {
      api_usage: [{ day_pt: '2026-11-15', units: 0, searches: 99 }],
      user_daily_usage: [{ user_id: 'u1', day_jst: '2026-11-16', kind: 'search', count: 30 }],
    }),
    fetchMap: router(),
  });
  assert.equal((await handle(post({ playlistId: PL }), deps)).status, 200);
});

test('他人のプレイリスト・存在しないものは 404 で、何も呼ばない', async () => {
  const { deps, calls } = makeDeps({
    env, tables: { playlists: [{ id: 'other', user_id: 'u2' }], playlist_tracks: [] }, fetchMap: router(),
  });
  assert.equal((await handle(post({ playlistId: 'other' }), deps)).status, 404);
  assert.equal((await handle(post({ playlistId: 'nope' }), deps)).status, 404);
  assert.equal(calls.length, 0);
});

test('playlistId がない・ログインなし・許可リスト外', async () => {
  const { deps } = makeDeps({ env, tables: base([]), fetchMap: router() });
  assert.equal((await handle(post({}), deps)).status, 400);
  assert.equal((await handle(post({ playlistId: PL }, { jwt: null }), deps)).status, 401);
  const na = makeDeps({ env, tables: base([]), allowed: false, fetchMap: router() });
  assert.equal((await handle(post({ playlistId: PL }), na.deps)).status, 403);
});

test('YouTube の検索が失敗したら UPSTREAM', async () => {
  const { deps } = makeDeps({ env, tables: base([trk('t1', '曲1')]), fetchMap: () => ({ status: 500, body: {} }) });
  const res = await handle(post({ playlistId: PL }), deps);
  assert.equal(res.status, 502);
  assert.equal((await res.json()).error.code, 'UPSTREAM');
});
