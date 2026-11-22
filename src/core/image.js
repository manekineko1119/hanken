// 長い辺が max を超えるときだけ、縦横比を保って縮める（端数は四捨五入）。
export function fitSize(w, h, max = 1600) {
  const long = Math.max(w, h);
  if (long <= max) return { w, h };
  const r = max / long;
  return { w: Math.round(w * r), h: Math.round(h * r) };
}

// サーバー（setlist-read）と同じ、base64 の文字数の合計の上限（4MB）。
export const MAX_TOTAL_BASE64 = 4 * 1024 * 1024;

export function totalBase64Length(images) {
  return images.reduce((sum, s) => sum + String(s).length, 0);
}

export function fitsTotal(images, max = MAX_TOTAL_BASE64) {
  return totalBase64Length(images) <= max;
}
