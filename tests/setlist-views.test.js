import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { readFileSync } from 'node:fs';
import { parseHash } from "../src/router.js";

// 画面が作ったリンクとボタンの動きを調べるのに必要な DOM API。
class Element extends EventTarget {
  constructor(tag) { super(); this.tag = tag; }
  children = [];
  attributes = {};
  value = '';
  get hash() { return this.attributes.href; }

  focus() { document.activeElement = this; }
  select() {}
  querySelector(sel) { const c = sel.slice(1); return this.find((n) => n !== this && n.className === c) ?? null; }
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

const mk = (over) => ({
  id: 's1', kind: 'setlist', live_id: 'live-1', live_artist_id: 'a1', artist_name: 'バンド', itunes_artist_id: null,
  title: '【セトリ】バンド', status: 'draft', candidates: [], saved_at: null, edited_at: null, youtube_playlist_id: null, ...over,
});
const artist = { id: 'a1', name: 'バンド', position: 0, itunes_artist_id: null };
const live = { id: 'live-1', date: '2026-12-01', venue: '港町ホール', title: 'T', memo: null, artists: [artist] };
let playlists = [];
let tracks = [];
let saved;

globalThis.fetch = async (input, init) => {
  const url = new URL(input.url ?? input);
  switch (url.pathname) {
    case '/rest/v1/playlists': return Response.json(playlists);
    case '/rest/v1/lives': return Response.json([live]);
    case '/rest/v1/playlist_tracks': return Response.json(tracks);
    case '/rest/v1/user_settings': return Response.json(null);
    case '/rest/v1/rpc/replace_playlist_tracks': saved = JSON.parse(init.body).p_tracks; return new Response(null, { status: 204 });
    default: throw new Error(`Unexpected request: ${url.pathname}`);
  }
};
globalThis.document = { createElement: (tag) => new Element(tag), createElementNS: (_ns, tag) => new Element(tag) };
globalThis.location = { hostname: 'localhost', hash: '', assign() {} };
globalThis.confirm = () => true;
const { renderPlaylistEdit } = await import('../src/views/playlist-edit.js');
const { renderLiveDetail } = await import('../src/views/live-detail.js');
const { renderSetlistRead } = await import('../src/views/setlist-read.js');

async function render(view, hash) {
  const container = new Element();
  location.hash = hash;
  view(container, { ...parseHash(hash), alive: () => true });
  await setImmediate();
  return container;
}
const byClass = (c, cls) => c.find((n) => n.className === cls);
const all = (c, pred, out = []) => { if (pred(c)) out.push(c); c.children.forEach((k) => all(k, pred, out)); return out; };
const trk = (title, uncertain) => ({ id: title, title, artist_name: 'バンド', source: 'setlist', is_latest: false, uncertain, position: 0 });

test('ライブの詳細：セトリがなければ「作る」で読み取りの画面へ。あれば「開く」', async () => {
  playlists = [];
  let c = await render(renderLiveDetail, '#/live/live-1');
  const row = byClass(c, 'setlist-line');
  assert.equal(row.children[0].textContent, 'セトリ：未作成');
  assert.equal(row.children[1].attributes.href, '#/live/live-1/setlist/a1');
  assert.equal(row.children[1].textContent, '作る');
  playlists = [{ id: 's1', live_artist_id: 'a1', kind: 'setlist', status: 'draft' }];
  c = await render(renderLiveDetail, '#/live/live-1');
  const row2 = byClass(c, 'setlist-line');
  assert.equal(row2.children[0].textContent, 'セトリ：下書き');
  assert.equal(row2.children[1].attributes.href, '#/playlist/s1');
});

test('セトリの編集：要確認の印とお知らせ。入れ替えの文は出さない。曲名を直すと印が消えて保存される', async () => {
  playlists = [mk()];
  tracks = [trk('曲A', false), trk('曲B', true)];
  const c = await render(renderPlaylistEdit, '#/playlist/s1');
  assert.equal(all(c, (n) => n.className === 'tag').length, 1);
  assert.ok(all(c, (n) => String(n.textContent).startsWith('確かめてほしい曲')).length);
  assert.equal(all(c, (n) => String(n.textContent).includes('候補がもうありません')).length, 0);
  assert.equal(all(c, (n) => n.textContent === '画像・文字から読み直す').length, 1);
  const titles = all(c, (n) => n.className === 'song-title');
  titles[1].dispatchEvent(new Event('click'));
  await setImmediate();
  const input = c.find((n) => n.tag === 'input' && n.attributes['aria-label'] === '曲名');
  input.value = ' 曲B直し ';
  const ok = c.find((n) => n.className === 'primary' && n.textContent === '保存');
  ok.dispatchEvent(new Event('click'));
  await setImmediate();
  assert.deepEqual(saved.map((t) => [t.title, t.uncertain]), [['曲A', false], ['曲B直し', false]]);
  assert.equal(all(c, (n) => n.className === 'tag').length, 0);
});

test('読み取りの画面：貼り付けが空なら何もしない。画像は5枚で止める', async () => {
  const c = await render(renderSetlistRead, '#/live/live-1/setlist/a1');
  assert.equal(c.find((n) => n.tag === 'h1').textContent, 'セトリを作る');
  const file = c.find((n) => n.tag === 'input' && n.attributes.type === 'file');
  file.files = [1, 2, 3, 4, 5];
  file.dispatchEvent(new Event('change'));
  await setImmediate();
  const msg = c.find((n) => n.attributes.role === 'alert');
  assert.equal(msg.textContent, '4枚まで選べます');
  assert.equal(location.hash, '#/live/live-1/setlist/a1');
});

test('セトリの編集：曲名を直している間は、並べ替えと消すを止める', async () => {
  playlists = [mk()];
  tracks = [trk('曲A', false), trk('曲B', false)];
  const c = await render(renderPlaylistEdit, '#/playlist/s1');
  c.find((n) => n.textContent === '編集').dispatchEvent(new Event('click'));
  all(c, (n) => n.className === 'song-title')[0].dispatchEvent(new Event('click'));
  await setImmediate();
  assert.ok(all(c, (n) => n.className === 'trash').every((n) => n.attributes.disabled === ''));
  assert.ok(all(c, (n) => n.className === 'handle').every((n) => n.attributes.disabled === ''));
});
