import { prelude, readJson, json, errorJson } from '../_shared/http.js';
import { normalizeName, titleKey } from '../_shared/normalize.js';
import { LIMITS } from '../_shared/quota.js';
import { getSearchUsage, recordSearch, recordUnits } from '../_shared/usage.js';
import { pickVideo } from '../_shared/youtube-pick.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const FRESH_MS = 30 * DAY_MS;
const TIMEOUT_MS = 8000;
const API = 'https://www.googleapis.com/youtube/v3';

function upstream(message) {
  const e = new Error(message);
  e.code = 'UPSTREAM';
  return e;
}

// 動画を探す（設計 4.4）。検索は共有のデータなので、ユーザーの鍵ではなく YT_API_KEY で呼ぶ。
async function searchVideos(deps, key, artist, title) {
  const qs = new URLSearchParams({
    part: 'snippet', q: `${artist} ${title}`, type: 'video', videoCategoryId: '10',
    maxResults: '5', regionCode: 'JP', key,
  });
  const res = await deps.fetch(`${API}/search?${qs}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw upstream('YouTube で動画を探せませんでした');
  const data = await res.json();
  return (data?.items ?? [])
    .filter((it) => it?.id?.videoId)
    .map((it) => ({ videoId: it.id.videoId, title: it.snippet?.title ?? '', channelTitle: it.snippet?.channelTitle ?? '' }));
}

// 動画がまだあるかとタイトルを確かめる（50件まで1回）。戻り値：Map(videoId → title)。
async function checkVideos(deps, key, ids) {
  const qs = new URLSearchParams({ part: 'snippet', id: ids.join(','), key });
  const res = await deps.fetch(`${API}/videos?${qs}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw upstream('YouTube で動画を確かめられませんでした');
  const data = await res.json();
  return new Map((data?.items ?? []).map((it) => [it.id, it.snippet?.title ?? '']));
}

export async function handle(req, deps) {
  const p = await prelude(req, deps);
  if (p.response) return p.response;
  const { user, origin } = p;
  const err = (code, msg, status) => errorJson(code, msg, status, origin, deps.env);

  const body = await readJson(req);
  const playlistId = body?.playlistId;
  if (typeof playlistId !== 'string' || !playlistId) return err('BAD_INPUT', 'playlistId が正しくありません', 400);

  try {
    // service role は RLS が効かないので、持ち主をここで確かめる。他人のものは「ない」と同じ扱い。
    const pl = await deps.db.from('playlists').select('id, user_id').eq('id', playlistId).maybeSingle();
    if (pl.error) throw upstream('プレイリストを確かめられませんでした');
    if (!pl.data || pl.data.user_id !== user.id) return err('BAD_INPUT', 'プレイリストが見つかりません', 404);

    const tr = await deps.db.from('playlist_tracks').select('*').eq('playlist_id', playlistId).order('position');
    if (tr.error) throw upstream('曲を読めませんでした');
    const tracks = tr.data;

    const now = deps.now();
    const nowMs = now.getTime();
    const nowIso = now.toISOString();
    const state = new Map(tracks.map((t) => [t.id, { videoId: t.video_id ?? null, videoTitle: t.video_title ?? null }]));
    const setVideo = async (t, v) => {
      const patch = v
        ? { video_id: v.videoId, video_title: v.title, video_checked_at: nowIso }
        : { video_id: null, video_title: null, video_checked_at: null };
      const r = await deps.db.from('playlist_tracks').update(patch).eq('id', t.id);
      if (r.error) throw upstream('動画を保存できませんでした');
      state.set(t.id, { videoId: v?.videoId ?? null, videoTitle: v?.title ?? null });
    };

    const isStale = (t) => t.video_id && !(Date.parse(t.video_checked_at) > nowMs - FRESH_MS);
    const stale = tracks.filter(isStale);
    let need = tracks.filter((t) => !t.video_id);
    const key = deps.env('YT_API_KEY');
    let usage = null;
    const loadUsage = async () => (usage ??= await getSearchUsage(deps.db, user.id, now));

    // 30日を過ぎた曲：videos.list だけで確かめ、消えていた曲だけ検索に回す。
    if (stale.length > 0) {
      if (!key) throw upstream('YouTube の API キーが設定されていません');
      await loadUsage();
      const alive = new Map();
      const ids = [...new Set(stale.map((t) => t.video_id))];
      for (let i = 0; i < ids.length; i += 50) {
        const batch = ids.slice(i, i + 50);
        usage = await recordUnits(deps.db, now, usage, 1);
        for (const [id, title] of await checkVideos(deps, key, batch)) alive.set(id, title);
      }
      for (const t of stale) {
        if (alive.has(t.video_id)) await setVideo(t, { videoId: t.video_id, title: alive.get(t.video_id) });
        else need.push(t);
      }
    }

    // 空の曲：video_cache → なければ search.list。
    const seen = new Map(); // 同じ曲が2つあっても、1回しか探さない
    let quotaHit = null;
    for (const t of need) {
      const aKey = normalizeName(t.artist_name);
      const tKey = titleKey(t.title);
      const ck = `${aKey}\u0000${tKey}`;
      let hit = seen.get(ck);
      if (hit === undefined) {
        const c = await deps.db.from('video_cache').select('*').eq('artist_key', aKey).eq('title_key', tKey).maybeSingle();
        if (c.error) throw upstream('動画の記録を読めませんでした');
        if (c.data && Date.parse(c.data.fetched_at) > nowMs - FRESH_MS) {
          hit = c.data.video_id ? { videoId: c.data.video_id, title: c.data.video_title ?? '' } : null;
        }
      }
      if (hit === undefined) {
        if (!key) throw upstream('YouTube の API キーが設定されていません');
        await loadUsage();
        if (usage.user >= LIMITS.search) { quotaHit = 'user'; break; }
        if (usage.global >= LIMITS.globalSearch) { quotaHit = 'global'; break; }
        usage = await recordSearch(deps.db, user.id, now, usage);
        const picked = pickVideo(await searchVideos(deps, key, t.artist_name, t.title), t.artist_name);
        hit = picked ? { videoId: picked.videoId, title: picked.title } : null;
        const up = await deps.db.from('video_cache').upsert({
          artist_key: aKey, title_key: tKey, video_id: hit?.videoId ?? null, video_title: hit?.title ?? null,
          channel_title: picked?.channelTitle ?? null, fetched_at: nowIso,
        });
        if (up.error) console.error('video_cache upsert failed', up.error.code);
      }
      seen.set(ck, hit);
      await setVideo(t, hit);
    }

    if (quotaHit === 'user') return err('QUOTA', '今日はこれ以上曲を探せません（1日30回まで）。ここまでの結果は保存しました', 429);
    if (quotaHit === 'global') return err('QUOTA', '今日はこれ以上曲を探せません。ここまでの結果は保存しました', 429);

    const left = Math.max(0, LIMITS.search - (usage ? usage.user : (await loadUsage()).user));
    return json({
      tracks: tracks.map((t) => ({ id: t.id, ...state.get(t.id) })),
      searchesLeft: left,
    }, 200, origin, deps.env);
  } catch (e) {
    if (e?.code === 'UPSTREAM') return err('UPSTREAM', e.message, 502);
    throw e;
  }
}
