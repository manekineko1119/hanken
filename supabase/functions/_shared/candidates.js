import { titleKey, isExcludedTitle } from './normalize.js';

// iTunes の曲一覧と Last.fm の曲名から、popular / recent の候補を作る（設計 4.3 の 2）。
// 曲名はいつも iTunes のもの。Cand.source の 'lastfm' は「Last.fm の順位で選んだ」の意味。
export function buildCandidates(itunesSongs, lastfmTitles) {
  const time = (s) => {
    const t = Date.parse(s.releaseDate);
    return Number.isNaN(t) ? -Infinity : t;
  };
  // 新しい順。同じ日は元の順（stable sort）。
  const sorted = [...(itunesSongs ?? [])]
    .filter((s) => s && s.title && !isExcludedTitle(s.title))
    .sort((a, b) => time(b) - time(a));

  const byKey = new Map(); // titleKey -> 最も新しい iTunes の曲
  for (const s of sorted) {
    const k = titleKey(s.title);
    if (k && !byKey.has(k)) byKey.set(k, s);
  }

  const recent = [...byKey.values()].map((s) => ({ title: s.title, source: 'itunes' }));

  const popular = [];
  const seen = new Set();
  for (const lt of lastfmTitles ?? []) {
    const k = titleKey(lt);
    const hit = byKey.get(k);
    if (hit && !seen.has(k)) {
      seen.add(k);
      popular.push({ title: hit.title, source: 'lastfm' });
    }
  }
  return { popular, recent };
}
