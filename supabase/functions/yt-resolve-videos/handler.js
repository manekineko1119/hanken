import { prelude, readJson, json, errorJson } from '../_shared/http.js';
import { decodeEntities } from '../_shared/html-entities.js';
import { normalizeName, titleKey } from '../_shared/normalize.js';
import { LIMITS } from '../_shared/quota.js';
import { getSearchUsage, incrementUsage } from '../_shared/usage.js';
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
    maxResults: '10', regionCode: 'JP', key,
  });
  const res = await deps.fetch(`${API}/search?${qs}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw upstream('YouTube で動画を探せませんでした');
  const data = await res.json();
  return (data?.items ?? [])
    .filter((it) => it?.id?.videoId)
    .map((it) => ({ videoId: it.id.videoId, title: decodeEntities(it.snippet?.title), channelTitle: decodeEntities(it.snippet?.channelTitle) }));
}

// ISO 8601 の長さ（PT4M33S など）を秒にする。読めなければ null。
function parseDuration(iso) {
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(String(iso ?? ''));
  if (!m) return null;
  return Number(m[1] ?? 0) * 86400 + Number(m[2] ?? 0) * 3600 + Number(m[3] ?? 0) * 60 + Number(m[4] ?? 0);
}

// 検索結果の再生時間を取る（1回1単位）。失敗したら空の Map（再生時間なしで選ぶ）。
async function fetchDurations(deps, key, ids) {
  try {
    const qs = new URLSearchParams({ part: 'contentDetails', id: ids.join(','), key });
    const res = await deps.fetch(`${API}/videos?${qs}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return new Map();
    const data = await res.json();
    return new Map((data?.items ?? []).map((it) => [it.id, parseDuration(it.contentDetails?.duration)]));
  } catch {
    return new Map();
  }
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
        ? { video_id: v.videoId, video_title: v.title, video_checked_at: v.checkedAt ?? nowIso }
        : { video_id: null, video_title: null, video_checked_at: null };
      const r = await deps.db.from('playlist_tracks').update(patch).eq('id', t.id);
      if (r.error) throw upstream('動画を保存できませんでした');
      state.set(t.id, { videoId: v?.videoId ?? null, videoTitle: v?.title ?? null });
    };

    const isStale = (t) => t.video_id && !(Date.parse(t.video_checked_at) > nowMs - FRESH_MS);
    const stale = tracks.filter(isStale);
    const need = tracks.filter((t) => !t.video_id);
    const dead = new Map(); // 消えていた動画の ID（video_cache に残っていても使わない）
    const key = deps.env('YT_API_KEY');
    let userCount = null; // 今日のこの人の検索回数（わかっているとき）

    // 30日を過ぎた曲：videos.list だけで確かめ、消えていた曲だけ検索に回す。
    if (stale.length > 0) {
      if (!key) throw upstream('YouTube の API キーが設定されていません');
      const alive = new Map();
      const ids = [...new Set(stale.map((t) => t.video_id))];
      for (let i = 0; i < ids.length; i += 50) {
        const batch = ids.slice(i, i + 50);
        userCount = (await incrementUsage(deps.db, user.id, now, { units: 1 })).user;
        for (const [id, title] of await checkVideos(deps, key, batch)) alive.set(id, title);
      }
      for (const t of stale) {
        if (alive.has(t.video_id)) await setVideo(t, { videoId: t.video_id, title: alive.get(t.video_id) });
        else { dead.set(t.id, t.video_id); need.push(t); }
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
        const isDead = c.data?.video_id && c.data.video_id === dead.get(t.id);
        if (c.data && Date.parse(c.data.fetched_at) > nowMs - FRESH_MS && !isDead) {
          // 元の確認時刻を引き継ぐ（コピーしただけで新しくしない）
          hit = c.data.video_id ? { videoId: c.data.video_id, title: c.data.video_title ?? '', checkedAt: c.data.fetched_at } : null;
        }
      }
      if (hit === undefined) {
        if (quotaHit) continue; // 枠を超えたあとも、cache にある曲は埋める
        if (!key) throw upstream('YouTube の API キーが設定されていません');
        // 先に足して、上限を超えていたら戻す（同時に呼ばれても、上限を超えて検索しない）。
        const after = await incrementUsage(deps.db, user.id, now, { searches: 1 });
        userCount = after.user;
        const over = after.user > LIMITS.search ? 'user' : after.global > LIMITS.globalSearch ? 'global' : null;
        if (over) {
          userCount = (await incrementUsage(deps.db, user.id, now, { searches: -1 })).user;
          quotaHit = over;
          continue;
        }
        const found = await searchVideos(deps, key, t.artist_name, t.title);
        if (found.length > 0) {
          userCount = (await incrementUsage(deps.db, user.id, now, { units: 1 })).user;
          const durations = await fetchDurations(deps, key, found.map((f) => f.videoId));
          for (const f of found) f.durationSec = durations.get(f.videoId) ?? undefined;
        }
        const picked = pickVideo(found, t.artist_name, t.title);
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

    userCount ??= (await getSearchUsage(deps.db, user.id, now)).user;
    const result = {
      tracks: tracks.map((t) => ({ id: t.id, ...state.get(t.id) })),
      searchesLeft: Math.max(0, LIMITS.search - userCount),
    };
    // 枠を超えたときも、ここまでの結果を返す（クライアントが「枠切れ」と「見つからない」を見分けられるように）。
    // 上限は決まりどおりの動きなので 200 で返す（429 にすると、ブラウザが毎回赤いエラーを出す）。
    if (quotaHit) {
      const message = quotaHit === 'user'
        ? '今日はこれ以上曲を探せません（1日30回まで）。ここまでの結果は保存しました'
        : '今日はこれ以上曲を探せません。ここまでの結果は保存しました';
      return json({ quota: { code: 'QUOTA', message }, ...result }, 200, origin, deps.env);
    }
    return json(result, 200, origin, deps.env);
  } catch (e) {
    if (e?.code === 'UPSTREAM') return err('UPSTREAM', e.message, 502);
    throw e;
  }
}
