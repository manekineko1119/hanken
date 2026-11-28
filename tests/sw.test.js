import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

// sw.js は import できない（ブラウザの Service Worker として動く）ので、
// 偽の self の中で実行し、関数と定数を取り出して調べる。
const root = new URL('../', import.meta.url);
const swSource = readFileSync(new URL('sw.js', root), 'utf8');
const ctx = vm.createContext({ URL, self: { addEventListener() {}, location: { origin: 'https://example.github.io' } } });
vm.runInContext(swSource, ctx);
const { VERSION, PRECACHE_URLS, shouldHandle } = ctx;

const ORIGIN = 'https://example.github.io';
const BASE = 'https://example.github.io/liveapp/';

test('版の名前（VERSION）がある', () => {
  assert.equal(typeof VERSION, 'string');
  assert.ok(VERSION.length > 0);
});

test('キャッシュの一覧は、すべて相対パス（./）で、サブパスのホスティングでも動く', () => {
  assert.ok(PRECACHE_URLS.length > 0);
  for (const u of PRECACHE_URLS) {
    assert.match(u, /^\.\//, `${u} は ./ で始める`);
  }
});

test('キャッシュの一覧に、supabase の API・Edge Functions・認証・Google の URL が入っていない', () => {
  for (const u of PRECACHE_URLS) {
    // 自分で持っている静的ファイル（vendor の supabase-js、_shared の純粋な関数）だけは除く
    assert.doesNotMatch(u.replace('./vendor/supabase-js.mjs', '').replace('./supabase/functions/_shared/', ''), /supabase/i);
    assert.doesNotMatch(u, /\/functions\/v1\//);
    assert.doesNotMatch(u, /\/auth\/v1\//);
    assert.doesNotMatch(u, /\/rest\/v1\//);
    assert.doesNotMatch(u, /google|youtube[.]com|youtu[.]be/i);
    assert.doesNotMatch(u, /^https?:/);
  }
});

test('キャッシュの一覧のファイルは、すべて実在する', () => {
  for (const u of PRECACHE_URLS) {
    if (u === './') continue;
    assert.ok(existsSync(new URL(u.slice(2), root)), `${u} がない`);
  }
});

test('src/ の JS・CSS と主なファイルが、一覧から漏れていない', () => {
  const walk = (dir) => readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
  const base = fileURLToPath(root);
  const files = walk(join(base, 'src')).map((p) => './' + relative(base, p).split(sep).join('/'));
  for (const f of files) assert.ok(PRECACHE_URLS.includes(f), `${f} が一覧にない`);
  for (const f of ['./', './index.html', './privacy.html', './guide.html', './manifest.webmanifest', './vendor/supabase-js.mjs']) {
    assert.ok(PRECACHE_URLS.includes(f), `${f} が一覧にない`);
  }
});

test('shouldHandle：同じオリジンの静的ファイルの GET だけ扱う', () => {
  assert.equal(shouldHandle(`${BASE}src/main.js`, 'GET', ORIGIN), true);
  assert.equal(shouldHandle(`${BASE}`, 'GET', ORIGIN), true);
  assert.equal(shouldHandle(`${BASE}privacy.html`, 'GET', ORIGIN), true);
});

test('shouldHandle：supabase の API・Edge Functions・認証は、ネットワークへ直接行かせる', () => {
  assert.equal(shouldHandle('https://abc.supabase.co/rest/v1/lives', 'GET', ORIGIN), false);
  assert.equal(shouldHandle('https://abc.supabase.co/functions/v1/yt-save-playlist', 'GET', ORIGIN), false);
  assert.equal(shouldHandle('https://abc.supabase.co/auth/v1/token', 'GET', ORIGIN), false);
  assert.equal(shouldHandle('http://127.0.0.1:55321/functions/v1/x', 'GET', ORIGIN), false);
});

test('shouldHandle：同じオリジンでも、API・認証のパスは扱わない', () => {
  assert.equal(shouldHandle(`${BASE}functions/v1/x`, 'GET', ORIGIN), false);
  assert.equal(shouldHandle(`${BASE}auth/v1/callback`, 'GET', ORIGIN), false);
  assert.equal(shouldHandle(`${BASE}rest/v1/lives`, 'GET', ORIGIN), false);
});

test('shouldHandle：Google・YouTube のホストは扱わない', () => {
  assert.equal(shouldHandle('https://accounts.google.com/o/oauth2/v2/auth', 'GET', ORIGIN), false);
  assert.equal(shouldHandle('https://www.googleapis.com/youtube/v3/search', 'GET', ORIGIN), false);
  assert.equal(shouldHandle('https://www.youtube.com/watch?v=x', 'GET', ORIGIN), false);
  assert.equal(shouldHandle('https://music.youtube.com/playlist?list=x', 'GET', ORIGIN), false);
});

test('shouldHandle：GET 以外は扱わない', () => {
  assert.equal(shouldHandle(`${BASE}src/main.js`, 'POST', ORIGIN), false);
  assert.equal(shouldHandle(`${BASE}src/main.js`, 'PUT', ORIGIN), false);
});

test('shouldHandle：ログインの戻り（?code= や #error）が付いた URL は扱わない', () => {
  assert.equal(shouldHandle(`${BASE}?code=abc`, 'GET', ORIGIN), false);
  assert.equal(shouldHandle(`${BASE}?error=access_denied`, 'GET', ORIGIN), false);
});

test('shouldHandle：壊れた URL は扱わない', () => {
  assert.equal(shouldHandle('not a url', 'GET', ORIGIN), false);
});

test('sw.js の中で、パスの先頭が / のものを使っていない', () => {
  assert.doesNotMatch(swSource, /['"`]\/(?!\/)[A-Za-z]/);
});

test('manifest：名前・説明・相対パスの start_url と scope・アイコン', () => {
  const m = JSON.parse(readFileSync(new URL('manifest.webmanifest', root), 'utf8'));
  assert.equal(m.name, '半券');
  assert.equal(m.short_name, '半券');
  assert.match(m.description, /LIVE TICKET STUB/);
  assert.equal(m.start_url, './');
  assert.equal(m.scope, './');
  assert.equal(m.display, 'standalone');
  assert.ok(m.icons.some((i) => i.sizes === '192x192'));
  assert.ok(m.icons.some((i) => i.sizes === '512x512' && i.purpose === 'maskable'));
  for (const i of m.icons) {
    assert.match(i.src, /^\.\//);
    assert.ok(existsSync(new URL(i.src.slice(2), root)), `${i.src} がない`);
  }
});

test('privacy.html：アプリ名・取るデータ・30日・取り消し方があり、個人情報（メール）がない', () => {
  const h = readFileSync(new URL('privacy.html', root), 'utf8');
  assert.match(h, /半券/);
  assert.match(h, /30日/);
  assert.match(h, /YouTube/);
  assert.match(h, /myaccount\.google\.com\/permissions/);
  assert.match(h, /href="\.\/#\/settings"/);
  assert.doesNotMatch(h, /[\w.+-]+@[\w-]+\.[\w.]+/);
});

test('sw.js：precache は cache: reload、fetch は cache: no-cache で、HTTP キャッシュの古いファイルを入れない', () => {
  assert.match(swSource, /new Request\(u, \{ cache: 'reload' \}\)/);
  assert.match(swSource, /fetch\(req, \{ cache: 'no-cache' \}\)/);
});

test('privacy.html：動画の情報の保存期間（30日・60日）を設計書どおりに書く', () => {
  const h = readFileSync(new URL('privacy.html', root), 'utf8');
  assert.match(h, /60日/);
  assert.doesNotMatch(h, /最長30日までしか/);
});

test('main.js から静的 import をたどって届くファイルは、すべて一覧に入っている（src/ の外や vendor/ も含む）', () => {
  const base = fileURLToPath(root);
  const seen = new Set();
  const queue = [join(base, 'src', 'main.js')];
  const re = /\b(?:import|export)\b[^'";]*?\bfrom\s*['"]([^'"]+)['"]|\bimport\s*['"]([^'"]+)['"]/g;
  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(re)) {
      const spec = m[1] ?? m[2];
      if (!spec.startsWith('.')) continue;
      queue.push(join(file, '..', spec));
    }
  }
  assert.ok(seen.size > 10);
  for (const f of seen) {
    const rel = './' + relative(base, f).split(sep).join('/');
    assert.ok(PRECACHE_URLS.includes(rel), `${rel} が一覧にない`);
  }
});

test('privacy.html：上下の戻るリンクは、どちらも class="back" で「戻る」・設定の画面へ', () => {
  const h = readFileSync(new URL('privacy.html', root), 'utf8');
  const links = [...h.matchAll(/<a class="back" href="\.\/#\/settings">([^<]*)<\/a>/g)];
  assert.equal(links.length, 2);
  assert.doesNotMatch(h, /<a class="back" href="\.\/">/);
  for (const l of links) assert.equal(l[1], '戻る');
  assert.doesNotMatch(h, /半券に戻る/);
});

test('guide.html：上下の戻るリンクは class="back" で「戻る」・設定の画面へ、使う画像はすべてあり、メールアドレスがない', () => {
  const h = readFileSync(new URL('guide.html', root), 'utf8');
  const links = [...h.matchAll(/<a class="back" href="\.\/#\/settings">([^<]*)<\/a>/g)];
  assert.equal(links.length, 2);
  assert.doesNotMatch(h, /<a class="back" href="\.\/">/);
  for (const l of links) assert.equal(l[1], '戻る');
  const imgs = [...h.matchAll(/<img [^>]*src="\.\/([^"]+)"/g)].map((m) => m[1]);
  assert.ok(imgs.length > 10);
  for (const f of imgs) assert.ok(existsSync(new URL(f, root)), `${f} がない`);
  assert.doesNotMatch(h, /[\w.+-]+@[\w-]+\.[\w.]+/);
});
