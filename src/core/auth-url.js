// ログインから戻ってきた URL を読む（DOM を使わない純粋な関数）。
const DROP = ['code', 'error', 'error_code', 'error_description'];

function strip(params) {
  for (const k of DROP) params.delete(k);
}

export function readAuthReturn(url) {
  const u = new URL(url);
  const code = u.searchParams.get('code');
  let denied = u.searchParams.get('error') === 'access_denied';
  strip(u.searchParams);

  // ハッシュ側に重ねて付く error（#error=...）。#/ のルートは触らない。
  const hash = u.hash;
  if (hash && !hash.startsWith('#/')) {
    const hp = new URLSearchParams(hash.slice(1));
    if (hp.get('error') === 'access_denied') denied = true;
    strip(hp);
    const rest = hp.toString();
    u.hash = rest ? `#${rest}` : '';
  }
  return { code, denied, cleanUrl: u.toString() };
}

// ログイン後の戻り先。#/ で始まり #/login でないものだけ通す。
export function pickReturnTo(saved) {
  const FALLBACK = '#/lives';
  if (typeof saved !== 'string' || !saved.startsWith('#/')) return FALLBACK;
  if (saved === '#/login' || saved.startsWith('#/login?')) return FALLBACK;
  return saved;
}

// ログインの状態を決める。code の交換に失敗したときに、未ログインと取り違えない。
export function classifyAuth({ hadCode = false, denied = false, session = null, error = null, timedOut = false } = {}) {
  if (timedOut) return 'unknown';
  if (session) return 'signedIn';
  if (denied) return 'signedOut';
  if (error || hadCode) return 'unknown';
  return 'signedOut';
}
