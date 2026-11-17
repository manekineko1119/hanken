// ハッシュ（#/live/abc?x=1）を { path, params, query } に分ける。
const FALLBACK = '/lives';

// [パターン, 名前つきの部分] の表。上から順に調べる（/live/new を /live/:id より先に）。
const ROUTES = [
  '/login',
  '/lives',
  '/live/new',
  '/live/:id/edit',
  '/live/:id/setlist/:artistId',
  '/live/:id',
  '/artist-pick',
  '/playlist/:id',
  '/prep',
  '/settings',
].map((pattern) => ({ pattern, parts: pattern.split('/').slice(1) }));

function decode(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function match(segments) {
  for (const { pattern, parts } of ROUTES) {
    if (parts.length !== segments.length) continue;
    const params = {};
    let ok = true;
    for (let i = 0; i < parts.length; i++) {
      if (parts[i].startsWith(':')) {
        if (segments[i] === '') { ok = false; break; }
        params[parts[i].slice(1)] = decode(segments[i]);
      } else if (parts[i] !== segments[i]) {
        ok = false;
        break;
      }
    }
    if (ok) return { path: pattern, params };
  }
  return null;
}

export function parseHash(hash) {
  const raw = String(hash ?? '').replace(/^#/, '');
  const qIndex = raw.indexOf('?');
  const pathPart = qIndex === -1 ? raw : raw.slice(0, qIndex);
  const queryPart = qIndex === -1 ? '' : raw.slice(qIndex + 1);

  const query = {};
  for (const [k, v] of new URLSearchParams(queryPart)) query[k] = v;

  const segments = pathPart.replace(/^\//, '').split('/');
  const found = pathPart === '' ? null : match(segments);
  if (!found) return { path: FALLBACK, params: {}, query: {} };
  return { path: found.path, params: found.params, query };
}

export function playlistHref(id, { fromPrep = false, confirm = false } = {}) {
  const query = new URLSearchParams();
  if (confirm) query.set('confirm', '1');
  if (fromPrep) query.set('from', 'prep');
  const suffix = query.toString();
  return `#/playlist/${encodeURIComponent(id)}${suffix ? `?${suffix}` : ''}`;
}
