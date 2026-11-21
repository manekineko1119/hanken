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
  // 'T-' で始まるタイトルは、検索した曲名に置き換える（曲名を含まない動画は選ばれないため）。
  if (url.includes('/youtube/v3/search')) {
    const track = new URL(url).searchParams.get('q').replace(/^バンドA /, '');
    const items = search.items.map((i) => ({ ...i, snippet: { ...i.snippet, title: i.snippet.title.startsWith('T-') ? track : i.snippet.title } }));
    return { body: { items } };
  }
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
    fetchMap: router({ search: (() => { const s = searchItems(['a', 'ファン'], ['b', 'バンドA - Topic']); s.items.forEach((i) => { i.snippet.title = '曲1'; }); return s; })() }),
  });
  const res = await handle(post({ playlistId: PL }), deps);
  assert.equal(res.status, 200);
  const j = await res.json();
  assert.deepEqual(j.tracks, [{ id: 't1', videoId: 'b', videoTitle: '曲1' }]);
  assert.equal(j.searchesLeft, 29);
  const url = new URL(searchCalls(calls)[0]);
  assert.equal(url.searchParams.get('q'), 'バンドA 曲1');
  assert.equal(url.searchParams.get('type'), 'video');
  assert.equal(url.searchParams.get('videoCategoryId'), '10');
  assert.equal(url.searchParams.get('maxResults'), '10');
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
  assert.equal(listCalls.length, 2); // 確かめ直し1回 + 検索のあとの再生時間1回
  assert.equal(new URL(listCalls[0]).searchParams.get('id'), 'alive,gone');
  assert.equal(searchCalls(calls).length, 1);
  assert.deepEqual(j.tracks, [
    { id: 't1', videoId: 'alive', videoTitle: 'L-alive' },
    { id: 't2', videoId: 'new2', videoTitle: '曲2' },
  ]);
  assert.equal(db.tables.playlist_tracks[0].video_checked_at, NOW.toISOString());
  assert.equal(db.tables.api_usage[0].units, 2);
  assert.equal(db.tables.api_usage[0].searches, 1);
});

test('見つからなかった曲は videoId null で、次回は検索しない', async () => {
  const { deps, calls } = makeDeps({ env, tables: base([trk('t1', '曲1')]), fetchMap: router({ search: { items: [] } }) });
  const j = await (await handle(post({ playlistId: PL }), deps)).json();
  assert.deepEqual(j.tracks, [{ id: 't1', videoId: null, videoTitle: null }]);
  await handle(post({ playlistId: PL }), deps);
  assert.equal(searchCalls(calls).length, 1);
});

test('一人30回を超えると、200 のまま quota（QUOTA）を返す（ブラウザに赤いエラーを出さない）', async () => {
  const { deps, calls } = makeDeps({
    env, tables: base([trk('t1', '曲1')], { user_daily_usage: [{ user_id: 'u1', day_jst: '2026-11-17', kind: 'search', count: 30 }] }),
    fetchMap: router(),
  });
  const res = await handle(post({ playlistId: PL }), deps);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).quota.code, 'QUOTA');
  assert.equal(calls.length, 0);
});

test('全員で90回を超えると QUOTA（太平洋時間の日付で数える）', async () => {
  const { deps, calls } = makeDeps({
    env, tables: base([trk('t1', '曲1')], { api_usage: [{ day_pt: '2026-11-16', units: 0, searches: 90 }] }),
    fetchMap: router(),
  });
  const res = await handle(post({ playlistId: PL }), deps);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).quota.code, 'QUOTA');
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

test('消えていた動画が video_cache に残っていても使わず、検索して cache を置き換える', async () => {
  const { deps, calls, db } = makeDeps({
    env,
    tables: base([trk('t1', '曲1', { video_id: 'dead', video_title: 'x', video_checked_at: daysAgo(40) })], {
      video_cache: [{ artist_key: 'バンドa', title_key: '曲1', video_id: 'dead', video_title: 'x', fetched_at: daysAgo(3) }],
    }),
    fetchMap: router({ list: listItems(), search: searchItems(['fresh', 'ファン']) }),
  });
  const j = await (await handle(post({ playlistId: PL }), deps)).json();
  assert.equal(searchCalls(calls).length, 1);
  assert.deepEqual(j.tracks, [{ id: 't1', videoId: 'fresh', videoTitle: '曲1' }]);
  assert.equal(db.tables.video_cache.length, 1);
  assert.equal(db.tables.video_cache[0].video_id, 'fresh');
});

test('30日を過ぎた video_cache は使わず、検索する', async () => {
  const { deps, calls } = makeDeps({
    env,
    tables: base([trk('t1', '曲1')], {
      video_cache: [{ artist_key: 'バンドa', title_key: '曲1', video_id: 'old', video_title: 'O', fetched_at: daysAgo(31) }],
    }),
    fetchMap: router({ search: searchItems(['n', 'ファン']) }),
  });
  const j = await (await handle(post({ playlistId: PL }), deps)).json();
  assert.equal(searchCalls(calls).length, 1);
  assert.equal(j.tracks[0].videoId, 'n');
});

test('同じ曲が2つあっても、検索は1回', async () => {
  const { deps, calls } = makeDeps({ env, tables: base([trk('t1', '曲1'), trk('t2', '曲1')]), fetchMap: router() });
  const j = await (await handle(post({ playlistId: PL }), deps)).json();
  assert.equal(searchCalls(calls).length, 1);
  assert.deepEqual(j.tracks.map((t) => t.videoId), ['s1', 's1']);
  assert.equal(j.searchesLeft, 29);
});

test('29回使用済みなら、もう1回だけ検索できて searchesLeft は 0', async () => {
  const { deps, calls } = makeDeps({
    env, tables: base([trk('t1', '曲1')], { user_daily_usage: [{ user_id: 'u1', day_jst: '2026-11-17', kind: 'search', count: 29 }] }),
    fetchMap: router(),
  });
  const res = await handle(post({ playlistId: PL }), deps);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).searchesLeft, 0);
  assert.equal(searchCalls(calls).length, 1);
});

test('途中で枠が切れても、ここまでの結果は保存され、QUOTA の本文に入る。cache の曲は枠切れのあとも埋まる', async () => {
  const { deps, calls, db } = makeDeps({
    env,
    tables: base([trk('t1', '曲1'), trk('t2', '曲2'), trk('t3', '曲3')], {
      user_daily_usage: [{ user_id: 'u1', day_jst: '2026-11-17', kind: 'search', count: 29 }],
      video_cache: [{ artist_key: 'バンドa', title_key: '曲3', video_id: 'c3', video_title: 'C3', fetched_at: daysAgo(1) }],
    }),
    fetchMap: router(),
  });
  const res = await handle(post({ playlistId: PL }), deps);
  assert.equal(res.status, 200);
  const j = await res.json();
  assert.equal(j.quota.code, 'QUOTA');
  assert.equal(j.searchesLeft, 0);
  assert.deepEqual(j.tracks, [
    { id: 't1', videoId: 's1', videoTitle: '曲1' },
    { id: 't2', videoId: null, videoTitle: null },
    { id: 't3', videoId: 'c3', videoTitle: 'C3' },
  ]);
  assert.equal(searchCalls(calls).length, 1);
  assert.equal(db.tables.playlist_tracks[0].video_id, 's1');
  // 超えた分は戻してあるので、30回のまま
  assert.equal(db.tables.user_daily_usage[0].count, 30);
  assert.equal(db.tables.api_usage[0].searches, 1);
});

test('枠の確認は、先に足してから行う（足したあとの値で判断し、超えたら戻す）', async () => {
  const { deps, db } = makeDeps({
    env, tables: base([trk('t1', '曲1')], { api_usage: [{ day_pt: '2026-11-16', units: 5, searches: 90 }] }),
    fetchMap: router(),
  });
  assert.equal((await handle(post({ playlistId: PL }), deps)).status, 200);
  assert.deepEqual(db.rpcCalls.map((c) => c.p_searches), [1, -1]);
  assert.equal(db.tables.api_usage[0].searches, 90);
  assert.equal(db.tables.api_usage[0].units, 5);
});

test('videos.list は50件ずつに分ける', async () => {
  const tracks = Array.from({ length: 55 }, (_, i) => trk(`t${i}`, `曲${i}`, { video_id: `v${i}`, video_title: 'x', video_checked_at: daysAgo(40) }));
  const { deps, calls, db } = makeDeps({
    env, tables: base(tracks),
    fetchMap: router({ list: listItems(...tracks.map((t) => t.video_id)) }),
  });
  const res = await handle(post({ playlistId: PL }), deps);
  assert.equal(res.status, 200);
  const listCalls = calls.filter((c) => c.includes('/youtube/v3/videos'));
  assert.deepEqual(listCalls.map((c) => new URL(c).searchParams.get('id').split(',').length), [50, 5]);
  assert.equal(db.tables.api_usage[0].units, 2);
  assert.equal(db.tables.api_usage[0].searches, 0);
});

test('検索のあと、videos.list（contentDetails）で再生時間を取り、1単位として数え、ショートを避ける', async () => {
  const search = searchItems(['short', 'バンドA'], ['full', 'バンドA']);
  search.items[0].snippet.title = '曲1';
  search.items[1].snippet.title = '曲1';
  const { deps, calls, db } = makeDeps({
    env, tables: base([trk('t1', '曲1')]),
    fetchMap: (url) => {
      if (url.includes('/youtube/v3/search')) return { body: search };
      if (url.includes('/youtube/v3/videos')) {
        return { body: { items: [{ id: 'short', contentDetails: { duration: 'PT45S' } }, { id: 'full', contentDetails: { duration: 'PT4M33S' } }] } };
      }
      throw new Error('unexpected ' + url);
    },
  });
  const j = await (await handle(post({ playlistId: PL }), deps)).json();
  const d = calls.filter((c) => c.includes('/youtube/v3/videos'));
  assert.equal(d.length, 1);
  assert.equal(new URL(d[0]).searchParams.get('part'), 'contentDetails');
  assert.equal(new URL(d[0]).searchParams.get('id'), 'short,full');
  assert.equal(db.tables.api_usage[0].units, 1);
  assert.equal(j.tracks[0].videoId, 'full');
});

test('再生時間を取れなくても、除かずに選ぶ', async () => {
  const { deps } = makeDeps({
    env, tables: base([trk('t1', '曲1')]),
    fetchMap: (url) => {
      if (url.includes('/youtube/v3/search')) return { body: { items: [{ id: { videoId: 'a' }, snippet: { title: '曲1', channelTitle: 'ファン' } }] } };
      return { status: 500, body: {} };
    },
  });
  const res = await handle(post({ playlistId: PL }), deps);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).tracks[0].videoId, 'a');
});

test('検索結果の HTML の文字参照を戻してから照合・保存する', async () => {
  const { deps, db } = makeDeps({
    env, tables: base([trk('t1', "Don't Stop & Go")]),
    fetchMap: router({ search: { items: [{ id: { videoId: 'e1' }, snippet: { title: 'Don&#39;t Stop &amp; Go', channelTitle: 'バンドA - Topic' } }] } }),
  });
  const j = await (await handle(post({ playlistId: PL }), deps)).json();
  assert.deepEqual(j.tracks, [{ id: 't1', videoId: 'e1', videoTitle: "Don't Stop & Go" }]);
  assert.equal(db.tables.playlist_tracks[0].video_title, "Don't Stop & Go");
  assert.equal(db.tables.video_cache[0].video_title, "Don't Stop & Go");
});

test('video_cache から写すときは、cache の元の確認時刻を引き継ぐ（今の時刻にしない）', async () => {
  const fetchedAt = daysAgo(29);
  const { deps, db } = makeDeps({
    env,
    tables: base([trk('t1', '曲1'), trk('t2', '曲1')], {
      video_cache: [{ artist_key: 'バンドa', title_key: '曲1', video_id: 'c1', video_title: 'C1', fetched_at: fetchedAt }],
    }),
    fetchMap: router(),
  });
  await handle(post({ playlistId: PL }), deps);
  assert.deepEqual(db.tables.playlist_tracks.map((r) => r.video_checked_at), [fetchedAt, fetchedAt]);
});
