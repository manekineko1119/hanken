import { prelude, readJson, json, errorJson } from '../_shared/http.js';
import { LIMITS, estimateSaveUnits, canSpend } from '../_shared/quota.js';
import { incrementUsage } from '../_shared/usage.js';
import { getAccessToken } from '../_shared/youtube-auth.js';

const TIMEOUT_MS = 8000;
const API = 'https://www.googleapis.com/youtube/v3';
const COST = { insert: 50, delete: 50, list: 1, create: 50 };
const TITLE_MAX = 150; // YouTube のプレイリスト名の上限

function coded(code, message, extra = {}) {
  const e = new Error(message);
  e.code = code;
  Object.assign(e, extra);
  return e;
}

export async function handle(req, deps) {
  const p = await prelude(req, deps);
  if (p.response) return p.response;
  const { user, origin } = p;
  const fail = (code, msg, status) => errorJson(code, msg, status, origin, deps.env);

  const body = await readJson(req);
  const playlistId = body?.playlistId;
  if (typeof playlistId !== 'string' || !playlistId) return fail('BAD_INPUT', 'playlistId が正しくありません', 400);
  if (body.title != null && typeof body.title !== 'string') return fail('BAD_INPUT', 'title が正しくありません', 400);

  // 使った回数・単位の記録（失敗しても、元のエラーを隠さない）
  const now = deps.now();
  let userCounted = false; // 本人の回数を足したか
  let reserved = 0; // api_usage に見積もりとして足した単位
  let spent = 0; // 実際に YouTube を呼んで使った単位
  let inserted = 0;
  let skipped = 0;

  const safeIncrement = async (opts) => {
    try { await incrementUsage(deps.db, user.id, now, { kind: 'save', ...opts }); } catch { /* 記録の失敗は無視 */ }
  };
  // 何も呼ばないまま止めるとき：足した分を全部戻す
  const refundAll = async () => {
    if (userCounted) await safeIncrement({ searches: -1 });
    if (reserved) await safeIncrement({ units: -reserved });
    userCounted = false;
    reserved = 0;
  };
  // 見積もりと実際の差を記録する（成功でも失敗でも）
  const settle = async () => {
    if (spent !== reserved) await safeIncrement({ units: spent - reserved });
    reserved = spent;
  };

  const yt = async (method, path, params, token, payload, cost) => {
    spent += cost; // 呼ぶ前に数える（つながらなかった場合も、多めに数える側に倒す）
    const qs = new URLSearchParams(params);
    let res;
    try {
      res = await deps.fetch(`${API}/${path}?${qs}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, ...(payload ? { 'Content-Type': 'application/json' } : {}) },
        body: payload ? JSON.stringify(payload) : undefined,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw coded('UPSTREAM', 'YouTube につながりませんでした');
    }
    return res;
  };
  const readReason = async (res) => {
    try { return (await res.json())?.error?.errors?.[0]?.reason ?? null; } catch { return null; }
  };
  const failed = async (res, what) => {
    if (res.status === 403 && (await readReason(res)) === 'quotaExceeded') {
      return coded('QUOTA', '今日の YouTube の枠がいっぱいになりました。日本時間の17時ごろ（冬は17時、夏は16時）に戻ります');
    }
    return coded('UPSTREAM', `YouTube で${what}できませんでした`);
  };

  try {
    // service role は RLS が効かないので、持ち主をここで確かめる。他人のものは「ない」と同じ扱い。
    const pl = await deps.db.from('playlists').select('*').eq('id', playlistId).maybeSingle();
    if (pl.error) throw coded('UPSTREAM', 'プレイリストを確かめられませんでした');
    if (!pl.data || pl.data.user_id !== user.id) return fail('BAD_INPUT', 'プレイリストが見つかりません', 404);
    const playlist = pl.data;

    const tr = await deps.db.from('playlist_tracks').select('*').eq('playlist_id', playlistId).order('position');
    if (tr.error) throw coded('UPSTREAM', '曲を読めませんでした');
    const playable = tr.data.filter((t) => t.video_id);
    skipped = tr.data.length - playable.length;
    if (playable.length === 0) return fail('BAD_INPUT', '入れられる曲がありません。先に曲を探してください', 400);

    const title = (body.title ?? '').trim() || playlist.title;
    if (!title || title.length > TITLE_MAX) return fail('BAD_INPUT', '題名が正しくありません', 400);

    // 一人あたりの回数：先に足して、超えていたら戻す（同時に押されても、上限を超えて保存しない）。
    const after = await incrementUsage(deps.db, user.id, now, { kind: 'save', searches: 1 });
    userCounted = true;
    if (after.user > LIMITS.save) {
      await refundAll();
      return fail('QUOTA', `今日は保存できる回数を超えました（1日${LIMITS.save}回まで）`, 429);
    }

    // YouTube の枠：見積もりを先に足して、9,500 を超えていたら戻す。
    const rebuild = Boolean(playlist.youtube_playlist_id);
    const estimate = estimateSaveUnits({ existingItems: rebuild ? playable.length : 0, count: playable.length, isNew: !rebuild });
    const u = await incrementUsage(deps.db, user.id, now, { kind: 'save', units: estimate });
    reserved = estimate;
    if (!canSpend(u.units - estimate, estimate)) {
      await refundAll();
      return fail('QUOTA', '今日の YouTube の枠がいっぱいです。日本時間の17時ごろ（冬は17時、夏は16時）に戻ります', 429);
    }

    let token;
    try {
      token = await getAccessToken(deps.db, user.id, deps);
    } catch (e) {
      await refundAll();
      throw e;
    }

    // 作り直し：いまの項目を全部消す。YouTube 側でプレイリストが消されていたら、新しく作る。
    let ytId = playlist.youtube_playlist_id;
    if (ytId) {
      const ids = [];
      let pageToken;
      let gone = false;
      do {
        const res = await yt('GET', 'playlistItems', { part: 'id', playlistId: ytId, maxResults: '50', ...(pageToken ? { pageToken } : {}) }, token, null, COST.list);
        if (res.status === 404) { gone = true; break; }
        if (!res.ok) throw await failed(res, '今の曲を確かめ');
        const data = await res.json();
        ids.push(...(data?.items ?? []).map((it) => it.id));
        pageToken = data?.nextPageToken;
      } while (pageToken);
      if (gone) {
        ytId = null;
      } else {
        for (const id of ids) {
          const res = await yt('DELETE', 'playlistItems', { id }, token, null, COST.delete);
          if (!res.ok && res.status !== 404) throw await failed(res, '今の曲を消');
        }
      }
    }

    if (!ytId) {
      const res = await yt('POST', 'playlists', { part: 'snippet,status' }, token,
        { snippet: { title }, status: { privacyStatus: 'private' } }, COST.create);
      if (!res.ok) throw await failed(res, 'プレイリストを作');
      ytId = (await res.json())?.id;
      if (!ytId) throw coded('UPSTREAM', 'YouTube からプレイリストの ID が返りませんでした');
      // 途中で失敗しても、次は「作り直し」の形で同じプレイリストに入れ直せるよう、先に ID を残す。
      const keep = await deps.db.from('playlists').update({ youtube_playlist_id: ytId }).eq('id', playlistId);
      if (keep.error) throw coded('UPSTREAM', 'プレイリストの記録を保存できませんでした');
    }

    for (const t of playable) {
      const res = await yt('POST', 'playlistItems', { part: 'snippet' }, token,
        { snippet: { playlistId: ytId, resourceId: { kind: 'youtube#video', videoId: t.video_id } } }, COST.insert);
      if (res.status === 404) { skipped += 1; continue; } // YouTube で消えた曲は飛ばして続ける
      if (!res.ok) throw await failed(res, '曲を入れ');
      inserted += 1;
    }

    await settle();
    const done = await deps.db.from('playlists').update({
      status: 'saved', youtube_playlist_id: ytId, saved_at: now.toISOString(),
    }).eq('id', playlistId);
    if (done.error) throw coded('UPSTREAM', '保存した結果を記録できませんでした');
    return json({
      youtubePlaylistId: ytId, url: `https://music.youtube.com/playlist?list=${ytId}`, inserted, skipped,
    }, 200, origin, deps.env);
  } catch (e) {
    await settle(); // 失敗でも、使った単位は記録に残す
    const extra = { inserted, skipped };
    const send = (code, status) => json({ error: { code, message: e.message }, ...extra }, status, origin, deps.env);
    if (e?.code === 'YT_RECONNECT') return send('YT_RECONNECT', 403);
    if (e?.code === 'QUOTA') return send('QUOTA', 429);
    if (e?.code === 'UPSTREAM') return send('UPSTREAM', 502);
    throw e;
  }
}
