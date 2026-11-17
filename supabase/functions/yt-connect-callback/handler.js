// Google からの戻り。JWT なし（verify_jwt = false）。本人かどうかは state で確かめる。
// 結果は、いつも 302 でアプリに戻す。
import { encrypt } from '../_shared/crypto.js';
import { safeReturnTo } from '../_shared/return-to.js';
import { GOOGLE_TOKEN_URL, YT_SCOPE, postForm } from '../_shared/youtube-auth.js';

const CHANNELS_URL = 'https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true';

export async function handle(req, deps) {
  if (req.method !== 'GET') return new Response('GET only', { status: 405 });
  const app = String(deps.env('APP_ORIGIN') ?? '').replace(/\/+$/, '');
  if (!app) return new Response('APP_ORIGIN is not set', { status: 500 });
  const redirect = (hashPath) => new Response(null, { status: 302, headers: { Location: `${app}/${hashPath}` } });
  const fail = (kind = 'error') => redirect(`#/settings?yt=${kind}`);

  const q = new URL(req.url).searchParams;
  const state = q.get('state');
  if (!state) return fail();

  const { data: st, error: stErr } = await deps.db.from('oauth_states').select('*').eq('state', state).maybeSingle();
  if (stErr || !st) return fail();
  // state は一度きり。以降どうなっても使えないよう、先に消す。
  const { error: delErr } = await deps.db.from('oauth_states').delete().eq('state', state);
  if (delErr) return fail();
  if (!(Date.parse(st.expires_at) > deps.now().getTime())) return fail();
  if (q.get('error') || !q.get('code')) return fail();

  try {
    const keyB64 = deps.env('YT_TOKEN_KEY');
    const tokRes = await postForm(deps, GOOGLE_TOKEN_URL, {
      grant_type: 'authorization_code',
      code: q.get('code'),
      code_verifier: st.code_verifier,
      client_id: deps.env('YT_CLIENT_ID'),
      client_secret: deps.env('YT_CLIENT_SECRET'),
      redirect_uri: deps.env('YT_REDIRECT_URI'),
    });
    if (!tokRes.ok) return fail();
    const tok = await tokRes.json();
    if (!tok?.access_token) return fail();

    // 許可の画面で youtube にチェックを入れなかったとき（設計 6.2）。鍵は保存しない。
    if (!String(tok.scope ?? '').split(/\s+/).includes(YT_SCOPE)) return fail('noscope');
    if (!tok.refresh_token) return fail();

    const chRes = await deps.fetch(CHANNELS_URL, {
      headers: { Authorization: `Bearer ${tok.access_token}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!chRes.ok) return fail();
    const ch = await chRes.json();
    const channelTitle = ch?.items?.[0]?.snippet?.title ?? null;

    const now = deps.now();
    const { error } = await deps.db.from('youtube_connections').upsert(
      {
        user_id: st.user_id,
        channel_title: channelTitle,
        refresh_token_enc: await encrypt(tok.refresh_token, keyB64),
        access_token_enc: await encrypt(tok.access_token, keyB64),
        access_expires_at: new Date(now.getTime() + (Number(tok.expires_in) || 3600) * 1000).toISOString(),
        connected_at: now.toISOString(),
      },
      { onConflict: 'user_id' },
    );
    if (error) return fail();
  } catch {
    return fail();
  }

  // 保存時に確かめてあるが、使う直前にもう一度確かめる。
  const returnTo = safeReturnTo(st.return_to);
  return returnTo ? redirect(returnTo) : redirect('#/settings');
}
