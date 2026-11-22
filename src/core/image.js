// 長い辺が max を超えるときだけ、縦横比を保って縮める（端数は四捨五入）。
export function fitSize(w, h, max = 1600) {
  const long = Math.max(w, h);
  if (long <= max) return { w, h };
  const r = max / long;
  return { w: Math.round(w * r), h: Math.round(h * r) };
}
