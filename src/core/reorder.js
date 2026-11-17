// 並べ替えの計算（画面に頼らない）。最新の枠（isLatest）は最後のまま動かさない。

// 最新の曲の場所（なければ -1）。
export function newestIndex(tracks) {
  return tracks.findIndex((t) => t.isLatest);
}

// 動かした曲を落とせる最後の場所。最新の曲があれば、その1つ前まで。
export function maxDropIndex(tracks) {
  const n = newestIndex(tracks);
  return n === -1 ? tracks.length - 1 : n - 1;
}

// from の曲を to の位置へ移す。動かせないときは同じ配列を返す。
export function moveTrackTo(tracks, from, to) {
  const ok = (i) => Number.isInteger(i) && i >= 0 && i < tracks.length;
  if (!ok(from) || !ok(to) || from === to || tracks[from].isLatest) return tracks;
  const dest = Math.min(to, maxDropIndex(tracks));
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

// 押した場所から threshold(px) より離れたら「引きずり始めた」。押しただけでは始めない。
export function hasDragged(startY, y, threshold = 4) {
  return Math.abs(y - startY) > threshold;
}

// 画面の端（edge px 以内）にいるときの、1フレームのスクロール量。上は負、下は正、そうでなければ 0。
export function autoScrollDelta(y, viewHeight, edge, speed) {
  if (y < edge) return -speed;
  if (y > viewHeight - edge) return speed;
  return 0;
}
