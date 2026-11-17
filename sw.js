/* 半券の Service Worker。
   方針（観戦のしおり 8章と同じ）：
   - 版ごとに、キャッシュを丸ごと入れ替える（VERSION を上げると、古いキャッシュは activate で全部消える）。
   - ログインと API はキャッシュしない。supabase・Google・YouTube のホスト、/functions/v1/・/auth/v1/・/rest/v1/、
     GET 以外、ログインの戻り（?code= ・?error=）は、Service Worker を通さずネットワークへ直接行かせる。
   - 入れるのは、同じオリジンの静的ファイルだけ。
   - パスはすべて相対（./）。GitHub Pages のサブパスでも動くようにする。
   アプリのファイルを足す・消したときは、PRECACHE_URLS を直し、VERSION を上げる（tests/sw.test.js が漏れを見つける）。 */
var VERSION = 'v2';
var CACHE_PREFIX = 'hanken-';
var CACHE_NAME = CACHE_PREFIX + VERSION;

var PRECACHE_URLS = [
  './',
  './index.html',
  './privacy.html',
  './manifest.webmanifest',
  './icons/favicon-32.png',
  './icons/apple-touch-icon.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './vendor/supabase-js.mjs',
  './supabase/functions/_shared/normalize.js',
  './src/main.js',
  './src/router.js',
  './src/config.js',
  './src/auth/auth.js',
  './src/core/auth-url.js',
  './src/core/live-form.js',
  './src/core/lives.js',
  './src/core/naming.js',
  './src/core/normalize.js',
  './src/core/playlist-list.js',
  './src/core/prep.js',
  './src/core/reorder.js',
  './src/core/save-confirm.js',
  './src/core/youtube.js',
  './src/data/lives.js',
  './src/data/playlists.js',
  './src/data/youtube.js',
  './src/ui/dom.js',
  './src/ui/drag-reorder.js',
  './src/ui/styles/app.css',
  './src/views/artist-pick.js',
  './src/views/live-detail.js',
  './src/views/live-edit.js',
  './src/views/lives.js',
  './src/views/login.js',
  './src/views/placeholder.js',
  './src/views/playlist-confirm.js',
  './src/views/playlist-edit.js',
  './src/views/prep-flow.js',
  './src/views/prep-list.js',
  './src/views/settings.js',
  './src/views/tabbar.js',
];

var NEVER_CACHE_HOSTS = /(^|\.)(supabase\.co|supabase\.in|supabase\.com|google\.com|googleapis\.com|gstatic\.com|youtube\.com|youtu\.be|googleusercontent\.com)$/i;
var NEVER_CACHE_PATHS = /\/(functions|auth|rest)\/v1\//;

// この要求を Service Worker で扱ってよいか（false なら、ネットワークへ直接行かせる）。
function shouldHandle(url, method, origin) {
  if (method !== 'GET') return false;
  var u;
  try {
    u = new URL(url);
  } catch (e) {
    return false;
  }
  if (u.origin !== origin) return false;
  if (NEVER_CACHE_HOSTS.test(u.hostname)) return false;
  if (NEVER_CACHE_PATHS.test(u.pathname)) return false;
  if (u.searchParams.has('code') || u.searchParams.has('error')) return false;
  return true;
}

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      // HTTP キャッシュ（GitHub Pages は max-age=600）の古いファイルを入れないよう、毎回取り直す
      return cache.addAll(PRECACHE_URLS.map(function (u) {
        return new Request(u, { cache: 'reload' });
      }));
    }).then(function () {
      return self.skipWaiting();
    }),
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) {
        return k.indexOf(CACHE_PREFIX) === 0 && k !== CACHE_NAME;
      }).map(function (k) {
        return caches.delete(k);
      }));
    }).then(function () {
      return self.clients.claim();
    }),
  );
});

// ネットワークを先に試し、つながらないときだけキャッシュを使う（更新がすぐ届き、機内モードでも開ける）。
self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (!shouldHandle(req.url, req.method, self.location.origin)) return;
  event.respondWith(
    fetch(req, { cache: 'no-cache' }).catch(function () {
      return caches.open(CACHE_NAME).then(function (cache) {
        return cache.match(req, { ignoreSearch: true });
      }).then(function (hit) {
        return hit || Response.error();
      });
    }),
  );
});
