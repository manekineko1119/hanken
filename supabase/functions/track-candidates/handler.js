import { prelude, readJson, json, errorJson } from '../_shared/http.js';
import { normalizeName } from '../_shared/normalize.js';
import { buildCandidates } from '../_shared/candidates.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const TIMEOUT_MS = 8000;
// Last.fm の人気順が取れたものは30日、取れなかった（一致0）ものは1日だけ使い回す。
const ttlMs = (payload) => (payload?.lastfmFound ? 30 : 1) * DAY_MS;

async function fetchItunes(id, deps) {
  const res = await deps.fetch(
    `https://itunes.apple.com/lookup?id=${id}&entity=song&country=JP&limit=200`,
    { signal: AbortSignal.timeout(TIMEOUT_MS) },
  );
  if (!res.ok) throw new Error(`itunes ${res.status}`);
  const data = await res.json();
  const results = data?.results ?? [];
  const artist = results.find((r) => r && r.wrapperType === 'artist' && r.artistName);
  const songs = results
    .filter((r) => r && r.wrapperType === 'track' && r.trackName)
    .map((r) => ({ title: r.trackName, releaseDate: r.releaseDate }));
  return { songs, artistName: artist ? String(artist.artistName).trim() : '' };
}

// 失敗・キーなし・未登録（error フィールド）は ok:false。答えが空なら ok:true, titles:[]。
async function fetchLastfmTitles(artist, deps) {
  const key = deps.env('LASTFM_API_KEY');
  if (!key) return { ok: false, titles: [] };
  try {
    const url = `https://ws.audioscrobbler.com/2.0/?method=artist.gettoptracks&artist=${encodeURIComponent(artist)}`
      + `&autocorrect=1&limit=50&api_key=${encodeURIComponent(key)}&format=json`;
    const res = await deps.fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return { ok: false, titles: [] };
    const data = await res.json();
    if (data?.error) return { ok: false, titles: [] };
    return { ok: true, titles: (data?.toptracks?.track ?? []).map((t) => t?.name).filter(Boolean) };
  } catch {
    return { ok: false, titles: [] };
  }
}

export async function handle(req, deps) {
  const p = await prelude(req, deps);
  if (p.response) return p.response;
  const { origin } = p;
  const bad = (m) => errorJson('BAD_INPUT', m, 400, origin, deps.env);

  const body = await readJson(req);
  const id = body?.itunesArtistId;
  if (!Number.isSafeInteger(id) || id <= 0) return bad('itunesArtistId が正しくありません');
  if (typeof body.artistName !== 'string') return bad('artistName が正しくありません');
  const artistName = body.artistName.trim();
  if (!artistName) return bad('artistName を入れてください');
  if (artistName.length > 100) return bad('artistName は100文字までです');

  const artistKey = `itunes:${id}`;
  const { data: cached, error: readErr } = await deps.db
    .from('track_cache').select('payload, fetched_at').eq('artist_key', artistKey).maybeSingle();
  if (readErr) console.error('track_cache read failed', readErr.code);
  if (cached?.payload && deps.now().getTime() - Date.parse(cached.fetched_at) <= ttlMs(cached.payload)) {
    return json(cached.payload, 200, origin, deps.env);
  }

  let itunes;
  try {
    itunes = await fetchItunes(id, deps);
  } catch {
    return errorJson('UPSTREAM', 'iTunes から曲を取れませんでした', 502, origin, deps.env);
  }
  const { songs, artistName: itunesName } = itunes;

  const first = await fetchLastfmTitles(artistName, deps);
  let best = buildCandidates(songs, first.titles);
  let lastfmOk = first.ok;
  if (itunesName && normalizeName(itunesName) !== normalizeName(artistName)) {
    const second = await fetchLastfmTitles(itunesName, deps);
    lastfmOk = lastfmOk && second.ok;
    const alt = buildCandidates(songs, second.titles);
    if (alt.popular.length > best.popular.length) best = alt;
  }
  const payload = { popular: best.popular, recent: best.recent, lastfmFound: best.popular.length > 0 };

  // Last.fm の失敗・キーなしの結果は、みんなが使う cache に入れない。
  if (lastfmOk) {
    const { error } = await deps.db.from('track_cache').upsert({
      artist_key: artistKey, payload, fetched_at: deps.now().toISOString(),
    });
    if (error) console.error('track_cache upsert failed', error.code);
  }
  return json(payload, 200, origin, deps.env);
}
