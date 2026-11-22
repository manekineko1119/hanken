// Edge Functions 共通：CORS・エラーの形・ログインと許可リストの確かめ。
// Deno 固有の API は使わない（node のテストから読み込む）。

export const ERROR_CODES = ['NOT_ALLOWED', 'QUOTA', 'YT_RECONNECT', 'UPSTREAM', 'BAD_INPUT', 'BUSY', 'NOT_PRIVATE', 'WRONG_USER', 'EXPIRED', 'LIMIT'];

const LOCAL_ORIGINS = ['http://localhost:8080', 'http://127.0.0.1:8080'];

export function corsHeaders(origin, env) {
  const allowed = [...LOCAL_ORIGINS];
  const app = env?.('APP_ORIGIN');
  // APP_ORIGIN は GitHub Pages のサブパス込みの URL（例 https://user.github.io/hanken）でもよい。
  // ブラウザの Origin はパスを持たないので、オリジンの部分だけで比べる。読めない値は許可しない。
  if (app) {
    try {
      allowed.push(new URL(app).origin);
    } catch {
      // 設定の誤り。ローカル以外は許可しない
    }
  }
  const h = { Vary: 'Origin' };
  if (origin && allowed.includes(origin)) {
    h['Access-Control-Allow-Origin'] = origin;
    h['Access-Control-Allow-Headers'] = 'authorization, content-type, apikey, x-client-info';
    h['Access-Control-Allow-Methods'] = 'POST, OPTIONS';
    h['Access-Control-Max-Age'] = '86400';
  }
  return h;
}

export function json(body, status, origin, env) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders(origin, env) },
  });
}

export function errorJson(code, message, status, origin, env) {
  return json({ error: { code, message } }, status, origin, env);
}

// JWT からユーザーを取り、許可リスト（allowed_emails）にあるか確かめる。
// service role では auth.jwt() が使えないので、表を直接引く。
// 戻り値：{ user } か { response }（そのまま返す Response）。
export async function requireUser(req, deps) {
  const origin = req.headers.get('Origin');
  const fail = (status, msg) => ({ response: errorJson('NOT_ALLOWED', msg, status, origin, deps.env) });
  const m = /^Bearer\s+(.+)$/i.exec(req.headers.get('Authorization') ?? '');
  if (!m) return fail(401, 'ログインが必要です');
  let user;
  try {
    const { data, error } = await deps.db.auth.getUser(m[1].trim());
    if (error || !data?.user) return fail(401, 'ログインが必要です');
    user = data.user;
  } catch {
    return fail(401, 'ログインが必要です');
  }
  const email = String(user.email ?? '').trim().toLowerCase();
  if (!email) return fail(403, 'このアカウントは使えません');
  const { data: row, error } = await deps.db.from('allowed_emails').select('email').eq('email', email).maybeSingle();
  if (error) return { response: errorJson('UPSTREAM', '許可リストを確かめられませんでした', 502, origin, deps.env) };
  if (!row) return fail(403, 'このアカウントは使えません');
  return { user };
}

// OPTIONS・POST 以外・ログインと許可リストをまとめて処理する。
// 戻り値：{ response } か { user, origin }。
export async function prelude(req, deps) {
  const origin = req.headers.get('Origin');
  if (req.method === 'OPTIONS') {
    return { response: new Response(null, { status: 204, headers: corsHeaders(origin, deps.env) }) };
  }
  if (req.method !== 'POST') {
    return { response: errorJson('BAD_INPUT', 'POST だけ使えます', 405, origin, deps.env) };
  }
  const r = await requireUser(req, deps);
  if (r.response) return r;
  return { user: r.user, origin };
}

export async function readJson(req) {
  try {
    const b = await req.json();
    return b && typeof b === 'object' ? b : null;
  } catch {
    return null;
  }
}
