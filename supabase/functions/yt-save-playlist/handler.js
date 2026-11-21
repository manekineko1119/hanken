import { prelude, readJson, json, errorJson } from '../_shared/http.js';
import { LIMITS, estimateSaveUnits, canSpend } from '../_shared/quota.js';
import { incrementUsage } from '../_shared/usage.js';
import { getAccessToken } from '../_shared/youtube-auth.js';

const TIMEOUT_MS = 8000;
const API = 'https://www.googleapis.com/youtube/v3';
const COST = { insert: 50, delete: 50, list: 1, create: 50, update: 50 };
const PRE_UNITS = 2; // 作り直しの確かめ（playlists.list と playlistItems.list の1ページ目）
const LOCK_SECONDS = 120; // 保存の鍵の長さ。途中で落ちても、これを過ぎれば自然に空く
const TITLE_MAX = 150; // YouTube のプレイリスト名の上限
// 1回の保存で入れる曲の上限。1人の保存で、全員の1日の枠（9,500単位）を使い切らないようにする。
export const MAX_TRACKS = 50;

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
  let locked = false; // このプレイリストの保存の鍵を持っているか
  let inserted = 0;
  let skipped = 0;

  const safeIncrement = async (opts) => {
    try { await incrementUsage(deps.db, user.id, now, { kind: 'save', ...opts }); } catch { /* 記録の失敗は無視 */ }
  };
  // 止めるとき：本人の回数を戻し、単位は実際に使った分だけ残す（何も呼んでいなければ全部戻る）
  const refundAll = async () => {
    if (userCounted) await safeIncrement({ searches: -1 });
    userCounted = false;
    await settle();
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
    if (res.status === 401) return coded('YT_RECONNECT', 'YouTube の許可が切れました。つなぎ直してください');
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

    // 同じプレイリストへの保存は1つずつ（同時に押されると、YouTube にプレイリストが2つできてしまう）。
    const claim = await deps.db.rpc('claim_playlist_save', { p_playlist_id: playlistId, p_user_id: user.id, p_seconds: LOCK_SECONDS });
    if (claim.error) throw coded('UPSTREAM', 'プレイリストを確かめられませんでした');
    if (claim.data !== true) return fail('BUSY', '保存中です。少し待ってからもう一度押してください', 409);
    locked = true;

    // 鍵を取る前に終わった保存の結果（youtube_playlist_id）を取りこぼさないよう、鍵を取ってから読み直す。
    const fresh = await deps.db.from('playlists').select('*').eq('id', playlistId).maybeSingle();
    if (fresh.error || !fresh.data) throw coded('UPSTREAM', 'プレイリストを確かめられませんでした');
    const playlist = fresh.data;

    const tr = await deps.db.from('playlist_tracks').select('*').eq('playlist_id', playlistId).order('position');
    if (tr.error) throw coded('UPSTREAM', '曲を読めませんでした');
    const playable = tr.data.filter((t) => t.video_id);
    skipped = tr.data.length - playable.length;
    if (playable.length === 0) return fail('BAD_INPUT', '入れられる曲がありません。先に曲を探してください', 400);
    if (playable.length > MAX_TRACKS) return fail('BAD_INPUT', `1回に保存できるのは${MAX_TRACKS}曲までです`, 400);

    const title = (body.title ?? '').trim() || playlist.title;
    if (!title || title.length > TITLE_MAX) return fail('BAD_INPUT', '題名が正しくありません', 400);

    // 一人あたりの回数：先に足して、超えていたら戻す（同時に押されても、上限を超えて保存しない）。
    const after = await incrementUsage(deps.db, user.id, now, { kind: 'save', searches: 1 });
    userCounted = true;
    if (after.user > LIMITS.save) {
      await refundAll();
      return fail('QUOTA', `今日は保存できる回数を超えました（1日${LIMITS.save}回まで）`, 429);
    }

    let token;
    token = await getAccessToken(deps.db, user.id, deps);

    // 作り直し：まず YouTube 側で非公開のままかを確かめる（list は1単位）。
    // 公開・限定公開に変えられていたら、何も変えずに止める（「非公開で保存」と表示しているため）。
    // YouTube 側でプレイリストが消されていたら、新しく作る。
    let ytId = playlist.youtube_playlist_id;
    let ids = [];
    let checkUnits = 0;
    const quotaFull = () => fail('QUOTA', '今日の YouTube の枠がいっぱいです。日本時間の17時ごろ（冬は17時、夏は16時）に戻ります', 429);
    if (ytId) {
      // 確かめの呼び出し（公開の状態・今の項目）の分も、呼ぶ前に全員の枠から取っておく。
      const pre = await incrementUsage(deps.db, user.id, now, { kind: 'save', units: PRE_UNITS });
      reserved = PRE_UNITS;
      if (!canSpend(pre.units - PRE_UNITS, PRE_UNITS)) {
        await refundAll();
        return quotaFull();
      }
      const res = await yt('GET', 'playlists', { part: 'status', id: ytId }, token, null, COST.list);
      checkUnits += COST.list;
      if (res.status === 404) ytId = null;
      else if (!res.ok) throw await failed(res, 'プレイリストを確かめ');
      else {
        const item = (await res.json())?.items?.[0];
        if (!item) ytId = null;
        else if (item.status?.privacyStatus !== 'private') {
          throw coded('NOT_PRIVATE', 'YouTube でこのプレイリストが非公開ではなくなっています。YouTube で非公開に戻してから、もう一度押してください');
        }
      }
    }
    if (ytId) {
      let pageToken;
      do {
        const res = await yt('GET', 'playlistItems', { part: 'id', playlistId: ytId, maxResults: '50', ...(pageToken ? { pageToken } : {}) }, token, null, COST.list);
        if (res.status === 404) { ytId = null; ids = []; break; }
        if (!res.ok) throw await failed(res, '今の曲を確かめ');
        const data = await res.json();
        ids.push(...(data?.items ?? []).map((it) => it.id));
        pageToken = data?.nextPageToken;
      } while (pageToken);
    }

    // YouTube の枠：本当の項目数で見積もりを先に足して、9,500 を超えていたら戻す（消す前に止める）。
    // 作り直しで名前が変わっていたら、YouTube 側の名前も更新する（playlists.update：50単位）。
    const rename = !!ytId && title !== playlist.title;
    const estimate = estimateSaveUnits({ existingItems: ids.length, count: playable.length, isNew: !ytId })
      + (rename ? COST.update : 0) + checkUnits;
    // 先に取っておいた分（reserved）との差だけ足す。
    const extra = Math.max(0, estimate - reserved);
    const u = await incrementUsage(deps.db, user.id, now, { kind: 'save', units: extra });
    reserved += extra;
    if (!canSpend(u.units - extra, extra)) {
      await refundAll();
      return quotaFull();
    }

    if (rename) {
      const res = await yt('PUT', 'playlists', { part: 'snippet' }, token, { id: ytId, snippet: { title } }, COST.update);
      if (!res.ok) throw await failed(res, '名前を変え');
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

    // 新しい曲を全部入れてから、前からある項目を消す（途中で止まっても、空のプレイリストにならない）。
    // 前の保存が途中で止まって残った項目も、ここで消える。
    for (const id of ids) {
      const res = await yt('DELETE', 'playlistItems', { id }, token, null, COST.delete);
      if (!res.ok && res.status !== 404) throw await failed(res, '前の曲を消');
    }

    await settle();
    const done = await deps.db.from('playlists').update({
      status: 'saved', title, youtube_playlist_id: ytId, saved_at: now.toISOString(),
    }).eq('id', playlistId);
    if (done.error) throw coded('UPSTREAM', '保存した結果を記録できませんでした');
    return json({
      youtubePlaylistId: ytId, url: `https://music.youtube.com/playlist?list=${ytId}`, inserted, skipped,
    }, 200, origin, deps.env);
  } catch (e) {
    // 失敗した保存は、本人の回数に数えない（やり直しで1日の回数を使い切らないように）。
    // ただし非公開でなかったとき（NOT_PRIVATE）は数える（直すのは YouTube 側なので、くり返し押させない）。
    // 使った単位は、全員の枠を守るため記録に残す。
    if (e?.code === 'NOT_PRIVATE') await settle(); else await refundAll();
    const extra = { inserted, skipped };
    const send = (code, status) => json({ error: { code, message: e.message }, ...extra }, status, origin, deps.env);
    if (e?.code === 'YT_RECONNECT') return send('YT_RECONNECT', 403);
    if (e?.code === 'NOT_PRIVATE') return send('NOT_PRIVATE', 409);
    if (e?.code === 'QUOTA') return send('QUOTA', 429);
    if (e?.code === 'UPSTREAM') return send('UPSTREAM', 502);
    throw e;
  } finally {
    // 鍵は必ず外す（外せなくても、期限が来れば空く）。
    if (locked) {
      try { await deps.db.rpc('release_playlist_save', { p_playlist_id: playlistId, p_user_id: user.id }); } catch { /* 期限で空く */ }
    }
  }
}
