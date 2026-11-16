import { prelude, readJson, json, errorJson } from '../_shared/http.js';
import { normalizeName } from '../_shared/normalize.js';
import { buildCandidates } from '../_shared/candidates.js';

const CACHE_MS = 30 * 24 * 60 * 60 * 1000;

async function fetchItunesSongs(id, deps) {
  const res = await deps.fetch(`https://itunes.apple.com/lookup?id=${id}&entity=song&country=JP&limit=200`);
  if (!res.ok) throw new Error(`itunes ${res.status}`);
  const data = await res.json();
  return (data?.results ?? [])
    .filter((r) => r && r.wrapperType === 'track' && r.trackName)
    .map((r) => ({ title: r.trackName, releaseDate: r.releaseDate }));
}

// 失敗・未登録・キーなしは []（リクエスト全体は失敗にしない）。
async function fetchLastfmTitles(artist, deps) {
  const key = deps.env('LASTFM_API_KEY');
  if (!key) return [];
  try {
    const url = `https://ws.audioscrobbler.com/2.0/?method=artist.gettoptracks&artist=${encodeURIComponent(artist)}`
      + `&autocorrect=1&limit=50&api_key=${encodeURIComponent(key)}&format=json`;
    const res = await deps.fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    if (data?.error) return [];
    return (data?.toptracks?.track ?? []).map((t) => t?.name).filter(Boolean);
  } catch {
    return [];
  }
}

export async function handle(req, deps) {
  const p = await prelude(req, deps);
  if (p.response) return p.response;
  const { origin } = p;
  const bad = (m) => errorJson('BAD_INPUT', m, 400, origin, deps.env);

  const body = await readJson(req);
  const id = body?.itunesArtistId;
  if (!Number.isInteger(id) || id <= 0) return bad('itunesArtistId が正しくありません');
  const names = {};
  for (const k of ['artistName', 'itunesArtistName']) {
    const v = body[k];
    if (v !== undefined && typeof v !== 'string') return bad(`${k} が正しくありません`);
    names[k] = (v ?? '').trim();
    if (names[k].length > 100) return bad(`${k} は100文字までです`);
  }
  if (!names.artistName) return bad('artistName を入れてください');
  const itunesName = names.itunesArtistName;

  const artistKey = `itunes:${id}`;
  const { data: cached } = await deps.db
    .from('track_cache').select('payload, fetched_at').eq('artist_key', artistKey).maybeSingle();
  if (cached?.payload && deps.now().getTime() - Date.parse(cached.fetched_at) <= CACHE_MS) {
    return json(cached.payload, 200, origin, deps.env);
  }

  let songs;
  try {
    songs = await fetchItunesSongs(id, deps);
  } catch {
    return errorJson('UPSTREAM', 'iTunes から曲を取れませんでした', 502, origin, deps.env);
  }

  let best = buildCandidates(songs, await fetchLastfmTitles(names.artistName, deps));
  if (itunesName && normalizeName(itunesName) !== normalizeName(names.artistName)) {
    const alt = buildCandidates(songs, await fetchLastfmTitles(itunesName, deps));
    if (alt.popular.length > best.popular.length) best = alt;
  }
  const payload = { popular: best.popular, recent: best.recent, lastfmFound: best.popular.length > 0 };

  await deps.db.from('track_cache').upsert({
    artist_key: artistKey, payload, fetched_at: deps.now().toISOString(),
  });
  return json(payload, 200, origin, deps.env);
}
