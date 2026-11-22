import { parseHash } from './router.js';
import { readAuthReturn, pickReturnTo, resolveAllowed } from './core/auth-url.js';
import { getAuthState, checkAllowed, signIn, signOut, RETURN_TO_KEY } from './auth/auth.js';
import { renderLogin } from './views/login.js';
import { renderTabbar } from './views/tabbar.js';
import { renderLives } from './views/lives.js';
import { renderLiveDetail } from './views/live-detail.js';
import { renderLiveEdit } from './views/live-edit.js';
import { renderSettings } from './views/settings.js';
import { renderPrep } from './views/prep-list.js';
import { renderArtistPick } from './views/artist-pick.js';
import { renderPlaylistEdit } from './views/playlist-edit.js';
import { renderSetlistRead } from './views/setlist-read.js';
import { el, setChildren, setBusy } from './ui/dom.js';

const main = document.querySelector('main');
const tabbar = document.querySelector('#tabbar');
const appHeader = document.querySelector('#app-header');
const desktop = window.matchMedia('(min-width: 1024px)');
let renderId = 0;
let showDesktopList = null;
let layout = null; // 表示中の一覧と中身の2枠（PC で選び直すときに一覧を作り直さないため）
let focusAfterSelection = null;

const VIEWS = {
  '/lives': renderLives,
  '/live/new': renderLiveEdit,
  '/live/:id/edit': renderLiveEdit,
  '/live/:id/setlist/:artistId': renderSetlistRead,
  '/live/:id': renderLiveDetail,
  '/artist-pick': renderArtistPick,
  '/playlist/:id': renderPlaylistEdit,
  '/prep': renderPrep,
  '/settings': renderSettings,
};
const LIST_LAYOUTS = {
  '/lives': { className: 'master-detail-lives', listLabel: 'ライブ一覧', contentLabel: 'ライブの内容', hint: 'ライブを選んでください' },
  '/prep': { listLabel: 'プレイリスト一覧', contentLabel: 'プレイリストの内容', hint: 'プレイリストを選んでください' },
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

function listPathFor({ path, query }) {
  if (path === '/lives' || path === '/live/:id' || path === '/live/:id/edit' || path === '/live/:id/setlist/:artistId') return '/lives';
  if (path === '/prep' || (path === '/playlist/:id' && query.from === 'prep')) return '/prep';
  return null;
}

function onListRowClick(event) {
  if (!desktop.matches || event.defaultPrevented || event.detail !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
  const hash = event.currentTarget.hash;
  if (hash !== location.hash) focusAfterSelection = hash;
}

// 一覧の行のうち、選んでいるものに印を付ける。
function markSelected(node, target, seen = { rows: 0, found: false }) {
  const href = node.getAttribute ? node.getAttribute('href') : node.attributes?.href;
  if (node.className === 'row' && href) {
    const on = Boolean(target) && href.split('?')[0].endsWith(target);
    node.setAttribute('aria-current', on ? 'true' : 'false');
    seen.rows += 1;
    if (on) seen.found = true;
  }
  for (const child of node.children ?? []) markSelected(child, target, seen);
  return seen;
}

function isShown(root) {
  return [...main.children].includes(root);
}

function showContent(current, selected, view, ctx, moveFocus) {
  const { content, list } = current;
  current.selectedId = ctx.params.id;
  current.root.className = current.baseClass + (selected ? ' has-selection' : '');
  const seen = markSelected(list, selected && ctx.params.id != null ? `/${encodeURIComponent(ctx.params.id)}` : null);
  // 作ったばかりの項目など、一覧にまだない行を選んだときは、一覧を読み直す。
  if (selected && seen.rows > 0 && !seen.found) current.refresh?.();
  setBusy(content, false);
  if (!selected) {
    setChildren(content, el('p', { class: 'note', text: LIST_LAYOUTS[current.listPath].hint }));
    return;
  }
  view(content, ctx);
  if (moveFocus) content.focus({ preventScroll: true });
}

function renderListLayout(listPath, selected, view, ctx, moveFocus) {
  // PC で同じ一覧の中を選び直すときは、一覧はそのまま残し、右の中身だけを替える（チラつかせない）。
  if (desktop.matches && layout && layout.listPath === listPath && layout.listMounted && isShown(layout.root)) {
    showContent(layout, selected, view, ctx, moveFocus);
    return;
  }

  const { className = '', listLabel, contentLabel } = LIST_LAYOUTS[listPath];
  const list = el('section', { class: 'master-detail-list', 'aria-label': listLabel });
  const content = el('section', { class: 'master-detail-content', 'aria-label': contentLabel, tabindex: '-1' });
  const baseClass = ['master-detail', className].filter(Boolean).join(' ');
  const root = el('div', { class: baseClass }, list, content);
  setChildren(main, root);
  const current = { listPath, root, baseClass, list, content, listMounted: false, refresh: null, selectedId: ctx.params.id };
  layout = current;

  function mountList() {
    current.listMounted = true;
    const listCtx = {
      ...ctx,
      // 一覧は選び直しても残るので、生きているかは「この2枠が表示中か」で決める。
      alive: () => layout === current && isShown(root),
      get selectedId() { return current.selectedId; },
      onListRowClick,
    };
    const refresh = VIEWS[listPath](list, listCtx);
    if (listPath === '/prep') current.refresh = refresh;
  }

  if (!selected) {
    mountList();
    showContent(current, false, view, ctx, moveFocus);
    return;
  }

  // 幅を広げたら一覧だけを足す。表示中の詳細・フォームは作り直さない。
  showDesktopList = () => {
    if (!desktop.matches || layout !== current) return;
    showDesktopList = null;
    mountList();
  };
  showDesktopList();
  showContent(current, true, view, ctx, moveFocus);
}

function render() {
  const current = ++renderId;
  showDesktopList = null;
  const moveFocus = desktop.matches && focusAfterSelection === location.hash;
  focusAfterSelection = null;
  setBusy(main, false);
  appHeader.hidden = authState !== 'signedIn';
  if (authState !== 'signedIn') {
    layout = null;
    renderTabbar(tabbar, { visible: false });
    renderLogin(main, { denied, unknown: authState === 'unknown', startFailed, onSignIn });
    return;
  }
  const route = parseHash(location.hash);
  renderTabbar(tabbar, { visible: true, path: route.path });
  const view = VIEWS[route.path];
  if (!view) {
    layout = null;
    // まだ作っていない画面は、一覧へ戻す導線だけ出す。
    setChildren(main, el('p', { class: 'note', text: '準備中です' }), el('a', { class: 'back', href: '#/lives', text: 'ライブの一覧へ' }));
    return;
  }
  window.scrollTo(0, 0);
  const ctx = {
    params: route.params, query: route.query, alive: () => current === renderId, onSignedOut,
    onPlaylistSaved: () => layout?.refresh?.(),
  };
  const listPath = listPathFor(route);
  if (listPath) renderListLayout(listPath, route.path !== listPath, view, ctx, moveFocus);
  else {
    layout = null;
    view(main, ctx);
  }
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
desktop.addEventListener('change', () => showDesktopList?.());
start();

// オフラインでも開けるように Service Worker を登録する（登録できなくてもアプリは動く）。
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}
