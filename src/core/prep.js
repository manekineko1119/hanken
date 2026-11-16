import { normalizeName, titleKey } from './normalize.js';

// 検索した名前とそろえた名前が完全一致する候補がちょうど1つのときだけ返す。
export function pickArtist(query, candidates) {
  const q = normalizeName(query);
  const hits = candidates.filter((c) => normalizeName(c.name) === q);
  return hits.length === 1 ? hits[0] : null;
}

// 完全一致 → 名前に query を含む（または逆）→ そのほか。同じ組の中は元の順。
export function orderArtists(query, candidates) {
  const q = normalizeName(query);
  const rank = (c) => {
    const n = normalizeName(c.name);
    if (n === q) return 0;
    if (q && n && (n.includes(q) || q.includes(n))) return 1;
    return 2;
  };
  return candidates
    .map((c, i) => ({ c, i, r: rank(c) }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((x) => x.c);
}

const track = (cand, artistName, isLatest) => ({
  title: cand.title, artistName, source: cand.source, isLatest,
});

// 最初の n 曲（設計 4.3 の 3）。人気の順、最新の曲は最後。
export function buildInitialTracks(cands, artistName, n = 10) {
  const used = new Set();
  const take = (list, k) => {
    const out = [];
    for (const c of list) {
      if (out.length >= k) break;
      const key = titleKey(c.title);
      if (used.has(key)) continue;
      used.add(key);
      out.push(c);
    }
    return out;
  };

  const latest = cands.recent[0] ?? null;
  if (latest) used.add(titleKey(latest.title));
  const slots = latest ? n - 1 : n;

  const picked = take(cands.popular, slots);
  if (picked.length < slots) picked.push(...take(cands.recent, slots - picked.length));

  const tracks = picked.map((c) => track(c, artistName, false));
  if (latest) tracks.push(track(latest, artistName, true));

  const rest = {
    popular: cands.popular.filter((c) => !used.has(titleKey(c.title))),
    recent: cands.recent.filter((c) => !used.has(titleKey(c.title))),
  };
  return { tracks, rest };
}

// 曲を消して、使っていない候補から次を足す（設計 4.3 の 4）。
export function replaceTrack(tracks, rest, index, artistName) {
  const removed = tracks[index];
  const kept = tracks.filter((_, i) => i !== index);
  const used = new Set(kept.map((t) => titleKey(t.title)));
  const popular = rest.popular.filter((c) => !used.has(titleKey(c.title)));
  const recent = rest.recent.filter((c) => !used.has(titleKey(c.title)));

  if (removed?.isLatest) {
    if (recent.length === 0) return { tracks: kept, rest: { popular, recent } };
    const [next, ...more] = recent;
    return {
      tracks: [...kept, track(next, artistName, true)],
      rest: { popular, recent: more },
    };
  }

  let next = null;
  let nextRest = { popular, recent };
  if (popular.length > 0) {
    next = popular[0];
    nextRest = { popular: popular.slice(1), recent };
  } else if (recent.length > 0) {
    next = recent[0];
    nextRest = { popular, recent: recent.slice(1) };
  }
  if (!next) return { tracks: kept, rest: nextRest };

  // 最新の枠は最後に置いたままにする。
  const latestAt = kept.findIndex((t) => t.isLatest);
  const added = track(next, artistName, false);
  const out = latestAt === -1 ? [...kept, added]
    : [...kept.slice(0, latestAt), added, ...kept.slice(latestAt)];
  return { tracks: out, rest: nextRest };
}
