import { parseHash } from './router.js';
import { readAuthReturn, pickReturnTo, resolveAllowed } from './core/auth-url.js';
import { getAuthState, checkAllowed, signIn, signOut, RETURN_TO_KEY } from './auth/auth.js';
import { renderLogin } from './views/login.js';
import { renderTabbar } from './views/tabbar.js';
import { renderLives } from './views/lives.js';
import { renderLiveDetail } from './views/live-detail.js';
import { renderLiveEdit } from './views/live-edit.js';
import { renderSettings } from './views/placeholder.js';
import { renderPrep } from './views/prep-list.js';
import { renderArtistPick } from './views/artist-pick.js';
import { renderPlaylistEdit } from './views/playlist-edit.js';
import { el, setChildren } from './ui/dom.js';

const main = document.querySelector('main');
const tabbar = document.querySelector('#tabbar');
const appHeader = document.querySelector('#app-header');
let renderId = 0;

const VIEWS = {
  '/lives': renderLives,
  '/live/new': renderLiveEdit,
  '/live/:id/edit': renderLiveEdit,
  '/live/:id': renderLiveDetail,
  '/artist-pick': renderArtistPick,
  '/playlist/:id': renderPlaylistEdit,
  '/prep': renderPrep,
  '/settings': renderSettings,
};
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

// ログアウトできたあと：状態を戻し、タブを出さずにログイン画面へ。
function onSignedOut() {
  authState = 'signedOut';
  denied = false;
  startFailed = false;
  starting = false;
  store((s) => s.removeItem(RETURN_TO_KEY));
  location.hash = '#/login'; // hashchange でも描くが、同じ内容なので二重でも害はない
  render();
}

function render() {
  const current = ++renderId;
  appHeader.hidden = authState !== 'signedIn';
  if (authState !== 'signedIn') {
    renderTabbar(tabbar, { visible: false });
    renderLogin(main, { denied, unknown: authState === 'unknown', startFailed, onSignIn });
    return;
  }
  const route = parseHash(location.hash);
  renderTabbar(tabbar, { visible: true, path: route.path });
  const view = VIEWS[route.path];
  if (!view) {
    // まだ作っていない画面は、一覧へ戻す導線だけ出す。
    setChildren(main, el('p', { class: 'note', text: '準備中です' }), el('a', { class: 'back', href: '#/lives', text: 'ライブの一覧へ' }));
    return;
  }
  window.scrollTo(0, 0);
  view(main, { params: route.params, query: route.query, alive: () => current === renderId, onSignedOut });
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
