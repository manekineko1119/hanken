import { parseHash } from './router.js';
import { readAuthReturn, pickReturnTo } from './core/auth-url.js';
import { getAuthState, signIn, RETURN_TO_KEY } from './auth/auth.js';
import { renderLogin } from './views/login.js';

const main = document.querySelector('main');
let authState = 'unknown';
let denied = false;

function render() {
  if (authState !== 'signedIn') {
    renderLogin(main, { denied, unknown: authState === 'unknown', onSignIn: signIn });
    return;
  }
  main.textContent = parseHash(location.hash).path;
}

async function start() {
  const ret = readAuthReturn(location.href);
  denied = ret.denied;
  // 先に状態を確かめる（Supabase が URL の code を読み終えてから URL を直す）。
  authState = await getAuthState();
  history.replaceState(null, '', ret.cleanUrl);

  if (authState === 'signedOut' && location.hash !== '#/login') {
    history.replaceState(null, '', '#/login');
  } else if (authState === 'signedIn') {
    const saved = sessionStorage.getItem(RETURN_TO_KEY);
    if (saved !== null || location.hash === '#/login') {
      sessionStorage.removeItem(RETURN_TO_KEY);
      history.replaceState(null, '', pickReturnTo(saved));
    }
  }
  render();
}

window.addEventListener('hashchange', render);
start();
