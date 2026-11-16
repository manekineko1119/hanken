// Supabase Auth（Google ログイン）。ブラウザの API は関数の中でだけ使う。
import { createClient } from '../../vendor/supabase-js.mjs';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from '../config.js';
import { pickReturnTo, classifyAuth } from '../core/auth-url.js';

export const RETURN_TO_KEY = 'liveapp.returnTo';
const TIMEOUT_MS = 3000;

let client = null;
// 最初に使うときに作る（作ったときに URL の code を読むため、main.js の順序に注意）。
export function getClient() {
  if (!client) {
    client = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: {
        flowType: 'pkce',
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
  }
  return client;
}

// 'signedIn' | 'signedOut' | 'unknown'。3秒で打ち切り、通信の失敗も 'unknown'（未ログイン扱いにしない）。
export async function getAuthState({ hadCode = false, denied = false } = {}) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ timedOut: true }), TIMEOUT_MS);
  });
  const check = (async () => {
    try {
      const auth = getClient().auth;
      const init = await auth.initialize(); // URL の code の交換を待つ
      const { data, error } = await auth.getSession();
      return { session: data?.session ?? null, error: init?.error ?? error ?? null };
    } catch (error) {
      return { session: null, error };
    }
  })();
  try {
    return classifyAuth({ hadCode, denied, ...(await Promise.race([check, timeout])) });
  } finally {
    clearTimeout(timer);
  }
}

export async function signIn() {
  try {
    sessionStorage.setItem(RETURN_TO_KEY, pickReturnTo(location.hash));
  } catch {
    // 覚えられなくても、ログインは続ける
  }
  const { error } = await getClient().auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: location.origin + location.pathname,
      queryParams: { prompt: 'select_account' },
    },
  });
  return { ok: !error };
}

export async function signOut() {
  try {
    const { error } = await getClient().auth.signOut();
    return { ok: !error };
  } catch {
    return { ok: false };
  }
}
