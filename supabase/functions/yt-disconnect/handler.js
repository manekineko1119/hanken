import { prelude, json, errorJson } from '../_shared/http.js';
import { decrypt } from '../_shared/crypto.js';
import { GOOGLE_REVOKE_URL, postForm } from '../_shared/youtube-auth.js';

// Google の許可を取り消してから、行を消す。取り消しに失敗しても、行は消す（設計 6.4）。
export async function handle(req, deps) {
  const p = await prelude(req, deps);
  if (p.response) return p.response;
  const { user, origin } = p;

  const { data: row, error } = await deps.db.from('youtube_connections').select('*').eq('user_id', user.id).maybeSingle();
  if (error) return errorJson('UPSTREAM', 'つながりを確かめられませんでした', 502, origin, deps.env);

  if (row) {
    try {
      const keyB64 = deps.env('YT_TOKEN_KEY');
      // refresh_token を取り消せば、アクセストークンも使えなくなる。
      const token = await decrypt(row.refresh_token_enc ?? row.access_token_enc, keyB64);
      await postForm(deps, GOOGLE_REVOKE_URL, { token });
    } catch {
      // 取り消せなくても先へ進む。
    }
    const { error: delErr } = await deps.db.from('youtube_connections').delete().eq('user_id', user.id);
    if (delErr) return errorJson('UPSTREAM', '鍵を消せませんでした', 502, origin, deps.env);
  }
  return json({ ok: true }, 200, origin, deps.env);
}
