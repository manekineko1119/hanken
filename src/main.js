import { parseHash } from './router.js';
import { readAuthReturn, pickReturnTo, resolveAllowed } from './core/auth-url.js';
import { getAuthState, checkAllowed, signIn, signOut, RETURN_TO_KEY } from './auth/auth.js';
import { renderLogin } from './views/login.js';

const main = document.querySelector('main');
let authState = 'unknown';
let denied = false;
let starting = false;
let startFailed = false;

function store(fn) {
  try {
    return fn(sessionStorage);
  } catch {
    return null; // 保存できなくても画面は出す
  }
}

async function onSignIn() {
  if (starting) return;
  starting = true;
  startFailed = false;
  let ok = false;
  try {
    ({ ok } = await signIn());
  } catch {
    ok = false;
  }
  if (!ok) {
    starting = false;
    startFailed = true;
    render();
  }
}

function render() {
  if (authState !== 'signedIn') {
    renderLogin(main, { denied, unknown: authState === 'unknown', startFailed, onSignIn });
    return;
  }
  main.textContent = parseHash(location.hash).path;
}

async function start() {
  const ret = readAuthReturn(location.href);
  denied = ret.denied;
  // 先に状態を確かめる（Supabase が URL の code を読み終えてから URL を直す）。
  authState = await getAuthState({ hadCode: ret.code !== null, denied });
  if (authState === 'signedIn') {
    // 許可リストから外された人は、ログインできていても止める。
    const { allowed, error } = await checkAllowed();
    const r = resolveAllowed({ state: authState, allowed, allowedError: error });
    authState = r.state;
    if (r.denied) {
      denied = true;
      await signOut();
    }
  }
  history.replaceState(null, '', ret.cleanUrl);

  if (authState === 'signedOut') {
    store((s) => s.removeItem(RETURN_TO_KEY));
    if (location.hash !== '#/login') history.replaceState(null, '', '#/login');
  } else if (authState === 'signedIn') {
    const saved = store((s) => s.getItem(RETURN_TO_KEY));
    if (saved !== null || location.hash === '#/login') {
      store((s) => s.removeItem(RETURN_TO_KEY));
      history.replaceState(null, '', pickReturnTo(saved));
    }
  }
  render();
}

window.addEventListener('hashchange', render);
start();
