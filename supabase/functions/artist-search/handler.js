import { prelude, readJson, json, errorJson } from '../_shared/http.js';

export async function handle(req, deps) {
  const p = await prelude(req, deps);
  if (p.response) return p.response;
  const { origin } = p;
  const bad = (m) => errorJson('BAD_INPUT', m, 400, origin, deps.env);

  const body = await readJson(req);
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  if (!name) return bad('アーティスト名を入れてください');
  if (name.length > 100) return bad('アーティスト名は100文字までです');

  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(name)}&entity=musicArtist&country=JP&limit=10`;
  let data;
  try {
    const res = await deps.fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`status ${res.status}`);
    data = await res.json();
  } catch {
    return errorJson('UPSTREAM', 'iTunes から候補を取れませんでした', 502, origin, deps.env);
  }
  const candidates = (data?.results ?? [])
    .filter((r) => r && r.artistId != null && r.artistName)
    .map((r) => ({ id: r.artistId, name: r.artistName, genre: r.primaryGenreName ?? '' }));
  return json({ candidates }, 200, origin, deps.env);
}
