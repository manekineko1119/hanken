import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { readFileSync } from 'node:fs';
import { parseHash } from '../src/router.js';

// 画面が作ったリンクとボタンの動きを調べるのに必要な DOM API。
class Element extends EventTarget {
  constructor(tag) { super(); this.tag = tag; }
  children = [];
  attributes = {};
  value = '';
  get hash() { return this.attributes.href; }

  focus() { document.activeElement = this; }
  setAttribute(key, value) {
    this.attributes[key] = String(value);
    if (key === 'value') this.value = String(value);
  }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  find(predicate) {
    if (predicate(this)) return this;
    for (const child of this.children) {
      const found = child.find(predicate);
      if (found) return found;
    }
  }
}

const playlist = {
  id: 'p1', kind: 'prep', live_id: 'live-1', live_artist_id: 'a1', artist_name: 'アーティスト',
  itunes_artist_id: null, title: '予習', status: 'draft', candidates: null, saved_at: null,
  edited_at: null, youtube_playlist_id: null, created_at: '2026-11-01T00:00:00Z',
  live: { date: '2026-11-30', venue: '会場' },
};
const track = { id: 't1', title: '曲名', artist_name: playlist.artist_name, source: 'manual', is_latest: false, position: 0 };
const artist = { id: 'a1', name: playlist.artist_name, position: 0, itunes_artist_id: null };
const live = { id: playlist.live_id, ...playlist.live, title: 'ライブの題名', memo: null, artists: [artist] };
const untitledLive = { ...live, id: 'live-untitled', date: '2000-01-01', title: ' ', venue: null };
const otherPlaylist = { ...playlist, id: 'p2', title: '別の予習', created_at: '2026-10-01T00:00:00Z' };
let connected;
let resolveNeedsReconnect;
let oauthReturnTo;
let candidateName;
let createdPlaylist;
let savedPlaylist;
let saveGate;
let artistSearchGate;

// 通信だけを置き換え、ビューから Supabase へのリクエストまでを通す。
globalThis.fetch = async (input, init) => {
  const url = new URL(input.url ?? input);
  switch (url.pathname) {
    case '/rest/v1/playlists':
      if (init?.method === 'POST') {
        createdPlaylist = { ...playlist, ...JSON.parse(init.body), id: 'new-prep', live: null };
        return Response.json({ id: createdPlaylist.id });
      }
      return Response.json([savedPlaylist ?? playlist, otherPlaylist, createdPlaylist].filter((p) => p && (!url.searchParams.has('id') || url.searchParams.get('id') === `eq.${p.id}`)));
    case '/rest/v1/lives': {
      if (init?.method === 'PATCH') return new Response(null, { status: 204 });
      const id = url.searchParams.get('id');
      return Response.json([live, untitledLive].filter((item) => !id || id === `eq.${item.id}`));
    }
    case '/rest/v1/live_artists':
      return init?.method === 'PATCH' ? new Response(null, { status: 204 }) : Response.json([artist]);
    case '/rest/v1/playlist_tracks':
      return Response.json([track]);
    case '/rest/v1/rpc/am_i_allowed':
      return Response.json(true);
    case '/rest/v1/rpc/youtube_connection_status':
      return Response.json({ connected });
    case '/functions/v1/artist-search':
      await artistSearchGate?.promise;
      return Response.json({ candidates: [{ id: 1, name: candidateName, genre: '' }] });
    case '/functions/v1/track-candidates':
      return Response.json({ popular: [], recent: [] });
    case '/functions/v1/yt-resolve-videos':
      return resolveNeedsReconnect
        ? Response.json({ error: { code: 'YT_RECONNECT' } }, { status: 403 })
        : Response.json({ tracks: [{ id: track.id, videoId: 'video-1', videoTitle: track.title }] });
    case '/functions/v1/yt-connect-start':
      ({ returnTo: oauthReturnTo } = JSON.parse(init.body));
      return Response.json({ url: 'https://accounts.example.com/connect' });
    case '/functions/v1/yt-save-playlist': {
      await saveGate?.promise;
      const { title } = JSON.parse(init.body);
      const youtubePlaylistId = 'new-youtube-list';
      savedPlaylist = { ...playlist, title, status: 'saved', youtube_playlist_id: youtubePlaylistId };
      return Response.json({ youtubePlaylistId, url: `https://music.youtube.com/playlist?list=${youtubePlaylistId}`, inserted: 1, skipped: 0 });
    }
    default:
      throw new Error(`Unexpected request: ${url.pathname}`);
  }
};
globalThis.document = { createElement: (tag) => new Element(tag) };
globalThis.location = { hostname: 'localhost', hash: '', assign() {} };
const { renderPrep } = await import('../src/views/prep-list.js');
const { renderPlaylistEdit } = await import('../src/views/playlist-edit.js');

async function render(view, hash) {
  const container = new Element();
  location.hash = hash;
  view(container, { ...parseHash(hash), alive: () => true });
  await setImmediate();
  return container;
}

function link(container, className) {
  return container.find((node) => node.className === className)?.attributes.href;
}

async function pressPrimary(container) {
  const button = container.find((node) => node.className === 'primary');
  assert.ok(button);
  button.dispatchEvent(new Event('click'));
  await setImmediate();
}

test('プレイリスト一覧から開いたライブ付きの予習は、一覧に戻る', async () => {
  const list = await render(renderPrep, '#/prep');
  const href = link(list, 'row');
  assert.ok(href);
  const edit = await render(renderPlaylistEdit, href);
  assert.equal(link(edit, 'back'), '#/prep');
});

test('従来のライブ詳細リンクと未対応の from は、ライブ詳細に戻る', async () => {
  for (const hash of ['#/playlist/p1', '#/playlist/p1?from=%23%2Fsettings']) {
    const edit = await render(renderPlaylistEdit, hash);
    assert.equal(link(edit, 'back'), '#/live/live-1');
  }
});

test('一覧から開いた予習は、保存の確認から編集を経由して一覧に戻る', async () => {
  connected = true;
  resolveNeedsReconnect = false;
  const edit = await render(renderPlaylistEdit, '#/playlist/p1?from=prep');
  await pressPrimary(edit);
  assert.equal(location.hash, '#/playlist/p1?confirm=1&from=prep');
  const confirm = await render(renderPlaylistEdit, location.hash);
  const back = link(confirm, 'back');
  assert.equal(back, '#/playlist/p1?from=prep');
  assert.equal(link(await render(renderPlaylistEdit, back), 'back'), '#/prep');
});

test('一覧から開いた予習は、YouTube に接続したあとも一覧へ戻れる', async () => {
  connected = false;
  oauthReturnTo = undefined;
  const edit = await render(renderPlaylistEdit, '#/playlist/p1?from=prep');
  await pressPrimary(edit);
  assert.equal(oauthReturnTo, '#/playlist/p1?confirm=1&from=prep');
});

test('保存確認で YouTube の接続が切れていたら、つなぎ直したあとも一覧へ戻れる', async () => {
  connected = true;
  resolveNeedsReconnect = true;
  oauthReturnTo = undefined;
  await render(renderPlaylistEdit, '#/playlist/p1?confirm=1&from=prep');
  assert.equal(oauthReturnTo, '#/playlist/p1?confirm=1&from=prep');
});

const desktop = new EventTarget();
const main = new Element('main');
const tabbar = new Element('nav');
const header = new Element('header');
let appStarted = false;

async function openApp(hash, wide = true) {
  desktop.matches = wide;
  if (appStarted) {
    await navigate(hash);
    return;
  }
  const { getClient } = await import('../src/auth/auth.js');
  getClient().auth.getSession = async () => ({ data: { session: { access_token: 'test' } } });
  Object.assign(document, { querySelector: (s) => ({ main, '#tabbar': tabbar, '#app-header': header })[s] });
  Object.defineProperty(location, 'href', { get: () => `http://localhost:8080/${location.hash}` });
  globalThis.history = { replaceState() {} };
  const stored = new Map();
  globalThis.sessionStorage = {
    getItem: (key) => stored.get(key) ?? null,
    setItem: (key, value) => stored.set(key, value),
    removeItem: (key) => stored.delete(key),
  };
  globalThis.window = Object.assign(new EventTarget(), {
    scrollTo() {},
    matchMedia(query) {
      assert.equal(query, '(min-width: 1024px)');
      return desktop;
    },
  });
  location.hash = hash;
  await import('../src/main.js');
  await setImmediate();
  appStarted = true;
}

async function navigate(hash) {
  location.hash = hash;
  window.dispatchEvent(new Event('hashchange'));
  await setImmediate();
}

function pane(label) {
  const section = main.find((node) => node.attributes['aria-label'] === label);
  assert.ok(section, `${label} の枠がある`);
  return section;
}

function currentHref(container) {
  return container.find((node) => [undefined, 'false'].includes(node.attributes['aria-current']) === false)?.attributes.href;
}

test('PC のプレイリストは一覧の選択と保存確認を同じレイアウトに出す', async () => {
  connected = true;
  resolveNeedsReconnect = false;
  await openApp('#/prep');
  const selected = link(pane('プレイリスト一覧'), 'row');
  assert.ok(pane('プレイリストの内容').find((node) => node.textContent?.includes('選んでください')));
  await navigate(selected);
  assert.equal(currentHref(pane('プレイリスト一覧')), selected);
  assert.equal(currentHref(tabbar), '#/prep');
  await pressPrimary(pane('プレイリストの内容'));
  const confirmation = location.hash;
  await navigate(confirmation);
  assert.equal(currentHref(pane('プレイリスト一覧')), selected);
  const content = pane('プレイリストの内容');
  assert.ok(content.find((node) => node.textContent === '保存の確認'));
  await navigate(link(content, 'back'));
  assert.ok(pane('プレイリストの内容').find((node) => node.textContent === `1. ${track.title}`));
  await navigate(confirmation);
  assert.equal(currentHref(pane('プレイリスト一覧')), selected);
  await navigate('#/playlist/p1');
  assert.equal(link(main, 'back'), '#/live/live-1');
  assert.equal(main.find((node) => node.attributes['aria-label'] === 'プレイリスト一覧'), undefined);
});

test('右枠で保存すると、左枠にも新しい題名・保存済み状態・YouTube Music のリンクが出る', async () => {
  connected = true;
  resolveNeedsReconnect = false;
  try {
    await openApp('#/playlist/p1?confirm=1&from=prep');
    const content = pane('プレイリストの内容');
    content.find((node) => node.attributes['aria-label'] === 'プレイリストの名前').value = '保存した題名';
    await pressPrimary(content);
    assert.ok(content.find((node) => node.textContent === '1曲を入れました'));
    const list = pane('プレイリスト一覧');
    assert.ok(list.find((node) => node.textContent === '保存した題名'));
    assert.ok(list.find((node) => node.textContent === '保存済み'));
    assert.ok(list.find((node) => node.attributes.href === 'https://music.youtube.com/playlist?list=new-youtube-list'));
  } finally {
    savedPlaylist = null;
  }
});

test('別の予習を開いてから保存が終わっても、表示中の一覧に保存結果を反映する', async () => {
  connected = true;
  resolveNeedsReconnect = false;
  savedPlaylist = null;
  saveGate = Promise.withResolvers();
  try {
    await openApp('#/playlist/p1?confirm=1&from=prep');
    const oldContent = pane('プレイリストの内容');
    oldContent.find((node) => node.attributes['aria-label'] === 'プレイリストの名前').value = '保存した題名';
    await pressPrimary(oldContent);
    await navigate('#/playlist/p2?from=prep');
    assert.equal(savedPlaylist, null);
    saveGate.resolve();
    await setImmediate();
    const list = pane('プレイリスト一覧');
    assert.ok(list.find((node) => node.textContent === '保存した題名'));
    assert.ok(list.find((node) => node.attributes.href === 'https://music.youtube.com/playlist?list=new-youtube-list'));
    assert.equal(currentHref(list), '#/playlist/p2?from=prep');
    assert.ok(pane('プレイリストの内容').find((node) => node.textContent === otherPlaylist.title));
    assert.equal(oldContent.find((node) => node.textContent === '1曲を入れました'), undefined);
  } finally {
    saveGate.resolve();
    saveGate = null;
    savedPlaylist = null;
  }
});

test('一覧を保存結果で更新しても、先に始めた予習作成が続く', async () => {
  connected = true;
  resolveNeedsReconnect = false;
  candidateName = 'アーティスト';
  saveGate = Promise.withResolvers();
  artistSearchGate = Promise.withResolvers();
  try {
    await openApp('#/playlist/p1?confirm=1&from=prep');
    await pressPrimary(pane('プレイリストの内容'));
    const list = pane('プレイリスト一覧');
    const input = list.find((node) => node.attributes['aria-label'] === 'アーティスト名');
    input.value = candidateName;
    await pressPrimary(list);
    saveGate.resolve();
    await setImmediate();
    artistSearchGate.resolve();
    await setImmediate();
    assert.equal(location.hash, '#/playlist/new-prep?from=prep');
    assert.equal(list.find((node) => node.attributes['aria-label'] === 'アーティスト名'), input);
    assert.equal(input.value, candidateName);
    await navigate(location.hash);
    assert.equal(currentHref(pane('プレイリスト一覧')), location.hash);
  } finally {
    saveGate.resolve();
    artistSearchGate.resolve();
    saveGate = null;
    artistSearchGate = null;
    savedPlaylist = null;
    createdPlaylist = null;
  }
});

test('PC の一覧をキーボードで選んだときだけ右枠にフォーカスを移す', async () => {
  document.activeElement = null;
  await openApp('#/playlist/p1?from=prep');
  assert.equal(document.activeElement, null);
  await navigate('#/prep');
  const row = pane('プレイリスト一覧').find((node) => node.className === 'row');
  row.focus();
  // Enter でアンカーを開くとブラウザは detail=0 の click を送る。
  row.dispatchEvent(Object.assign(new Event('click'), { detail: 0 }));
  await navigate(row.hash);
  assert.equal(document.activeElement, pane('プレイリストの内容'));
});

test('ライブ編集を狭い画面で開いてから PC 幅にしてもフォームの入力が残る', async () => {
  await openApp('#/live/live-1/edit', false);
  const form = main.find((node) => node.tag === 'form');
  assert.ok(form);
  const title = form.find((node) => node.id === 'f-タイトル');
  title.value = '編集中の題名';
  title.dispatchEvent(new Event('input'));
  desktop.matches = true;
  desktop.dispatchEvent(new Event('change'));
  await setImmediate();
  const detail = pane('ライブの内容');
  assert.equal(detail.find((node) => node.tag === 'form'), form);
  assert.equal(title.value, '編集中の題名');
  assert.equal(currentHref(pane('ライブ一覧')), '#/live/live-1');
  assert.equal(currentHref(tabbar), '#/lives');
  const back = link(detail, 'back');
  form.dispatchEvent(new Event('submit', { cancelable: true }));
  await setImmediate();
  assert.equal(location.hash, '#/live/live-1');
  assert.equal(back, location.hash);
  await navigate(location.hash);
  assert.equal(currentHref(pane('ライブ一覧')), '#/live/live-1');
  assert.ok(pane('ライブの内容').find((node) => node.attributes.href === '#/live/live-1/edit'));
});

test('ライブの券には日付・登録タイトル・会場だけを表示する', async () => {
  await openApp('#/lives');
  const list = pane('ライブ一覧');
  const registered = list.find((node) => node.attributes.href === '#/live/live-1');
  assert.deepEqual(registered.children.map((node) => node.textContent), [
    '2026/11/30（月）', live.title, live.venue,
  ]);
  const untitled = list.find((node) => node.attributes.href === '#/live/live-untitled');
  assert.deepEqual(untitled.children.map((node) => node.textContent).filter(Boolean), [
    '2000/01/01（土）', 'タイトル未設定',
  ]);
  await navigate(untitled.hash);
  assert.ok(pane('ライブの内容').find((node) => node.textContent === artist.name));
});

test('設定の YouTube 状態・操作とアカウントの項目は囲いのない画面に出る', async () => {
  connected = false;
  await openApp('#/settings?yt=noscope');
  assert.equal(main.find((node) => node.className === 'on-paper'), undefined);
  assert.ok(main.find((node) => node.textContent === 'つながっていません'));
  assert.ok(main.find((node) => node.tag === 'button' && node.textContent === 'YouTube につなぐ'));
  assert.ok(main.find((node) => node.attributes.role === 'alert' && node.textContent.includes('YouTube の権限')));
  assert.ok(main.find((node) => node.tag === 'button' && node.textContent === 'ログアウト'));
  assert.equal(main.find((node) => node.textContent === 'プライバシーポリシー').attributes.href, './privacy.html');

  connected = true;
  await navigate('#/settings');
  assert.ok(main.find((node) => node.textContent === 'つながっています：チャンネル名なし'));
  assert.ok(main.find((node) => node.tag === 'button' && node.textContent === '切断'));
});

for (const [candidate, choose] of [['アーティスト', false], ['候補のアーティスト', true]]) {
  test(`一覧のアーティスト名から作った予習は右枠に開く（${choose ? '候補を選ぶ' : '名前が一致する'}）`, async () => {
    candidateName = candidate;
    createdPlaylist = null;
    await openApp('#/prep');
    const list = pane('プレイリスト一覧');
    list.find((node) => node.attributes['aria-label'] === 'アーティスト名').value = 'アーティスト';
    await pressPrimary(list);
    if (choose) {
      assert.equal(location.hash, '#/artist-pick');
      await navigate(location.hash);
      const option = main.find((node) => node.tag === 'button' && node.textContent === candidate);
      assert.ok(option);
      option.dispatchEvent(new Event('click'));
      await setImmediate();
    }
    assert.equal(location.hash, '#/playlist/new-prep?from=prep');
    await navigate(location.hash);
    assert.equal(currentHref(pane('プレイリスト一覧')), location.hash);
    assert.equal(link(pane('プレイリストの内容'), 'back'), '#/prep');
  });
}

test('紙の補助文字は生成りと古い紙の両方でコントラスト比が4.5以上', () => {
  const css = readFileSync(new URL('../src/ui/styles/app.css', import.meta.url), 'utf8');
  const luminance = (name) => {
    const [, hex] = css.match(new RegExp(`--${name}: #([a-f0-9]{6});`));
    return [0.2126, 0.7152, 0.0722].reduce((sum, weight, i) => {
      const srgb = parseInt(hex.slice(i * 2, i * 2 + 2), 16) / 255;
      const linear = srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
      return sum + weight * linear;
    }, 0);
  };
  for (const paper of ['paper', 'paper-old']) {
    const ratio = (luminance(paper) + 0.05) / (luminance('ink-soft') + 0.05);
    assert.ok(ratio >= 4.5, `${paper}: ${ratio.toFixed(2)}:1`);
  }
});
