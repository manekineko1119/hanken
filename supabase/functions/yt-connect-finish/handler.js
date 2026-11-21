// YouTube とつなぐ流れの最後。ログイン中のアプリから呼ぶ（JWT あり）。
// callback が保留（youtube_pending）に置いた鍵を、始めた人と同じ人のときだけ youtube_connections に移す。
// 別の人に許可の URL を踏ませても、その人の鍵が自分のアカウントに結び付かないようにするため。
import { prelude, readJson, json, errorJson } from '../_shared/http.js';
import { safeReturnTo } from '../_shared/return-to.js';

export async function handle(req, deps) {
  const p = await prelude(req, deps);
  if (p.response) return p.response;
  const { user, origin } = p;
  const fail = (code, msg, status) => errorJson(code, msg, status, origin, deps.env);

  const body = await readJson(req);
  const pendingId = body?.pendingId;
  if (typeof pendingId !== 'string' || !pendingId || pendingId.length > 100) return fail('BAD_INPUT', 'pendingId が正しくありません', 400);

  const { data: pd, error } = await deps.db.from('youtube_pending').select('*').eq('id', pendingId).maybeSingle();
  if (error) return fail('UPSTREAM', 'つなぐ準備を確かめられませんでした', 502);
  if (!pd) return fail('BAD_INPUT', 'つなぐ準備が見つかりません。もう一度つないでください', 404);
  // 保留は一度きり。どうなっても使えないよう、先に消す。
  const del = await deps.db.from('youtube_pending').delete().eq('id', pendingId);
  if (del.error) return fail('UPSTREAM', 'つなぐ準備を確かめられませんでした', 502);

  if (pd.user_id !== user.id) {
    return fail('WRONG_USER', 'ほかのアカウントで始めたつなぎ方でした。この画面から、もう一度つないでください', 403);
  }
  if (!(Date.parse(pd.expires_at) > deps.now().getTime())) {
    return fail('EXPIRED', '時間が切れました。もう一度つないでください', 400);
  }

  const { error: upErr } = await deps.db.from('youtube_connections').upsert(
    {
      user_id: user.id,
      channel_title: pd.channel_title,
      refresh_token_enc: pd.refresh_token_enc,
      access_token_enc: pd.access_token_enc,
      access_expires_at: pd.access_expires_at,
      connected_at: deps.now().toISOString(),
    },
    { onConflict: 'user_id' },
  );
  if (upErr) return fail('UPSTREAM', 'つないだ結果を保存できませんでした', 502);

  return json({ returnTo: safeReturnTo(pd.return_to) ?? '#/settings', channelTitle: pd.channel_title ?? null }, 200, origin, deps.env);
}
