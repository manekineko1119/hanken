import { toSetlistTracks } from './setlist.js';

// 曲名を直す。前後の空白を除き、空・範囲外なら変えない。直した曲は「要確認」を外す。
export function renameTrack(tracks, index, title) {
  const t = String(title ?? '').trim();
  if (!t || !Number.isInteger(index) || index < 0 || index >= tracks.length) return tracks.slice();
  return tracks.map((x, i) => (i === index ? { ...x, title: t, uncertain: false } : x));
}

// 曲を最後に足す。同じ曲名があっても足す。空は足さない。
export function addSetlistTrack(tracks, title, artistName) {
  const t = String(title ?? '').trim();
  if (!t) return tracks.slice();
  return [...tracks, ...toSetlistTracks([{ title: t, uncertain: false }], artistName)];
}
