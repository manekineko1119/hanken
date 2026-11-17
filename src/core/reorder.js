// 並べ替えの計算（画面に頼らない）。最新の枠（isLatest）は最後のまま動かさない。

// from の曲を to の位置へ移す。動かせないときは同じ配列を返す。
export function moveTrackTo(tracks, from, to) {
  const ok = (i) => Number.isInteger(i) && i >= 0 && i < tracks.length;
  if (!ok(from) || !ok(to) || from === to || tracks[from].isLatest) return tracks;
  const lastMovable = tracks.findIndex((t) => t.isLatest);
  const max = lastMovable === -1 ? tracks.length - 1 : lastMovable - 1;
  const dest = Math.min(to, max);
  if (dest === from) return tracks;
  const out = tracks.slice();
  const [item] = out.splice(from, 1);
  out.splice(dest, 0, item);
  return out;
}

// 引きずっている行（from）の中心が y のとき、落とす場所。mids は各行の元の中心の位置。
export function dropIndex(mids, from, y) {
  let n = 0;
  mids.forEach((m, j) => { if (j !== from && m < y) n += 1; });
  return Math.max(0, Math.min(mids.length - 1, n));
}
