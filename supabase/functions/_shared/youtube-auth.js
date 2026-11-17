// YouTube の鍵（トークン）の扱い。Deno 固有の API は使わない（node のテストから読み込む）。
// 必要な Secrets：YT_CLIENT_ID・YT_CLIENT_SECRET・YT_TOKEN_KEY（設計 6.3）。
import { encrypt, decrypt } from './crypto.js';

export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const GOOGLE_REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
export const YT_SCOPE = 'https://www.googleapis.com/auth/youtube';

const EXPIRY_MARGIN_MS = 60 * 1000;

export function formBody(obj) {
  return new URLSearchParams(Object.entries(obj).filter(([, v]) => v != null)).toString();
}

export function postForm(deps, url, obj) {
  return deps.fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: formBody(obj),
    signal: AbortSignal.timeout(8000),
  });
}

function codedError(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}

// 有効なアクセストークンを返す。切れていたら更新して保存し直す。
// invalid_grant（7日で切れた・取り消された）なら行を消して YT_RECONNECT を投げる。
// deps = { fetch, env, now }
export async function getAccessToken(admin, userId, deps) {
  const { data: row, error } = await admin.from('youtube_connections').select('*').eq('user_id', userId).maybeSingle();
  if (error) throw codedError('UPSTREAM', 'YouTube のつながりを確かめられませんでした');
  if (!row) throw codedError('YT_RECONNECT', 'YouTube につながっていません');

  const keyB64 = deps.env('YT_TOKEN_KEY');
  const nowMs = deps.now().getTime();
  const expiresMs = row.access_expires_at ? Date.parse(row.access_expires_at) : NaN;
  if (row.access_token_enc && Number.isFinite(expiresMs) && expiresMs - EXPIRY_MARGIN_MS > nowMs) {
    try {
      return await decrypt(row.access_token_enc, keyB64);
    } catch {
      // 読めなければ、下で取り直す。
    }
  }

  let refresh;
  try {
    refresh = await decrypt(row.refresh_token_enc, keyB64);
  } catch {
    // 鍵（YT_TOKEN_KEY）の設定ミスでも起きるので、行は消さない（消してよいのは invalid_grant のときだけ）。
    throw codedError('UPSTREAM', 'YouTube の鍵を読めませんでした。設定を確かめてください');
  }

  let res;
  let body = null;
  try {
    res = await postForm(deps, GOOGLE_TOKEN_URL, {
      grant_type: 'refresh_token',
      refresh_token: refresh,
      client_id: deps.env('YT_CLIENT_ID'),
      client_secret: deps.env('YT_CLIENT_SECRET'),
    });
    body = await res.json();
  } catch {
    if (!res) throw codedError('UPSTREAM', 'Google につながりませんでした');
  }
  if (!res.ok) {
    if (body?.error === 'invalid_grant') {
      await admin.from('youtube_connections').delete().eq('user_id', userId);
      throw codedError('YT_RECONNECT', 'YouTube の許可が切れました。つなぎ直してください');
    }
    throw codedError('UPSTREAM', 'YouTube の鍵を更新できませんでした');
  }
  if (!body?.access_token) throw codedError('UPSTREAM', 'YouTube の鍵を更新できませんでした');

  const patch = {
    access_token_enc: await encrypt(body.access_token, keyB64),
    access_expires_at: new Date(nowMs + (Number(body.expires_in) || 3600) * 1000).toISOString(),
  };
  if (body.refresh_token) patch.refresh_token_enc = await encrypt(body.refresh_token, keyB64);
  const { error: upErr } = await admin.from('youtube_connections').update(patch).eq('user_id', userId);
  if (upErr) throw codedError('UPSTREAM', 'YouTube の鍵を保存できませんでした');
  return body.access_token;
}
