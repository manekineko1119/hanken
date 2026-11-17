import { normalizeName, titleKey } from './normalize.js';

// 検索した名前とそろえた名前が完全一致する候補がちょうど1つのときだけ返す。
export function pickArtist(query, candidates) {
  const q = normalizeName(query);
  if (!q) return null;
  const hits = candidates.filter((c) => normalizeName(c.name) === q);
  return hits.length === 1 ? hits[0] : null;
}

// 予習のアーティスト名：選んだ iTunes の候補の正式な名前（YouTube・Last.fm の検索とプレイリスト名に使う）。
// 入力した名前（ひらがな読みなど）のままだと、YouTube で本人の曲が見つからないことがある。
export function prepArtistName(typed, candidate) {
  const n = typeof candidate?.name === 'string' ? candidate.name.trim() : '';
  return n || typed;
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
  if (!Number.isInteger(index) || index < 0 || index >= tracks.length) return { tracks, rest };
  const removed = tracks[index];
  const kept = tracks.filter((_, i) => i !== index);
  const used = new Set(kept.map((t) => titleKey(t.title)));
  used.add(titleKey(removed.title)); // 消した曲を、すぐ次の候補として出し直さない
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

// 人気の順のデータがあったか（Last.fm の曲が入っている、または人気の候補が残っている）。
export function hasPopularity(tracks, rest) {
  return tracks.some((t) => t.source === 'lastfm') || (rest?.popular?.length ?? 0) > 0;
}

// 1つ上・下へ動かす。最新の枠は最後のまま（動かせず、その下へも動かせない）。
export function moveTrack(tracks, index, dir) {
  const to = dir === 'up' ? index - 1 : index + 1;
  if (!Number.isInteger(index) || index < 0 || index >= tracks.length) return tracks;
  if (to < 0 || to >= tracks.length) return tracks;
  if (tracks[index].isLatest || tracks[to].isLatest) return tracks;
  const out = tracks.slice();
  [out[index], out[to]] = [out[to], out[index]];
  return out;
}

// 曲名を打ち込んで足す。最新の枠の前に入れる。空・重複は { tracks（そのまま）, duplicate }。
export function addManualTrack(tracks, title, artistName) {
  const t = String(title ?? '').trim();
  if (!t) return { tracks, duplicate: false };
  const key = titleKey(t);
  if (tracks.some((x) => titleKey(x.title) === key)) return { tracks, duplicate: true };
  const added = { title: t, artistName, source: 'manual', isLatest: false };
  const latestAt = tracks.findIndex((x) => x.isLatest);
  const out = latestAt === -1 ? [...tracks, added]
    : [...tracks.slice(0, latestAt), added, ...tracks.slice(latestAt)];
  return { tracks: out, duplicate: false };
}
