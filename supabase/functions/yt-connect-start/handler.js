import { prelude, readJson, json, errorJson } from '../_shared/http.js';
import { safeReturnTo } from '../_shared/return-to.js';
import { YT_SCOPE } from '../_shared/youtube-auth.js';

const STATE_TTL_MS = 10 * 60 * 1000;

function randomB64url(bytes) {
  return bytesToB64url(globalThis.crypto.getRandomValues(new Uint8Array(bytes)));
}

function bytesToB64url(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function challengeOf(verifier) {
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  return bytesToB64url(digest);
}

export async function handle(req, deps) {
  const p = await prelude(req, deps);
  if (p.response) return p.response;
  const { user, origin } = p;

  const body = await readJson(req);
  const returnTo = safeReturnTo(body?.returnTo);
  if (!returnTo) return errorJson('BAD_INPUT', '戻り先が正しくありません', 400, origin, deps.env);

  const clientId = deps.env('YT_CLIENT_ID');
  const redirectUri = deps.env('YT_REDIRECT_URI');
  if (!clientId || !redirectUri) return errorJson('UPSTREAM', 'YouTube の設定が足りません', 502, origin, deps.env);

  const state = randomB64url(32);
  const codeVerifier = randomB64url(32);
  const { error } = await deps.db.from('oauth_states').insert({
    state,
    user_id: user.id,
    code_verifier: codeVerifier,
    return_to: returnTo,
    expires_at: new Date(deps.now().getTime() + STATE_TTL_MS).toISOString(),
  });
  if (error) return errorJson('UPSTREAM', 'つなぐ準備を保存できませんでした', 502, origin, deps.env);

  const q = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: YT_SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    state,
    code_challenge: await challengeOf(codeVerifier),
    code_challenge_method: 'S256',
  });
  return json({ url: `https://accounts.google.com/o/oauth2/v2/auth?${q}` }, 200, origin, deps.env);
}
