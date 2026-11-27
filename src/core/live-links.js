// ライブの「地図」と「終電」の URL を作る純粋な関数。
// URLSearchParams は空白を + にするので使わず、項目の順を固定した文字列で組む。

const enc = encodeURIComponent;

// 前後の空白（全角も）と末尾の「駅」を除く。空なら null。
export function normalizeStation(name) {
  if (name == null) return null;
  const s = String(name).trim().replace(/駅$/, '').trim();
  return s || null;
}

// 会場名と住所の空でない方を半角スペースでつなぐ。両方空なら null。
function place(live) {
  const parts = [live?.venue, live?.venue_address]
    .map((v) => (v == null ? '' : String(v).trim()))
    .filter(Boolean);
  return parts.length ? parts.join(' ') : null;
}

// 会場までの経路（Google マップ・電車）
export function directionsUrl(live) {
  const p = place(live);
  if (!p) return null;
  return `https://www.google.com/maps/dir/?api=1&destination=${enc(p)}&travelmode=transit`;
}

// 会場の周りの飲食店（Google マップ検索）
export function nearbyUrl(live) {
  const p = place(live);
  if (!p) return null;
  return `https://www.google.com/maps/search/?api=1&query=${enc(`${p} 周辺 飲食店`)}`;
}

// 終電の検索（Yahoo!乗換案内）。会場の最寄り駅 → 自分の最寄り駅
export function lastTrainUrl(live, homeStation) {
  const from = normalizeStation(live?.venue_station);
  const to = normalizeStation(homeStation);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(live?.date ?? '');
  if (!from || !to || !m) return null;
  const [, y, mo, d] = m;
  return `https://transit.yahoo.co.jp/search/result?from=${enc(from)}&to=${enc(to)}&y=${y}&m=${mo}&d=${d}&hh=12&m1=0&m2=0&type=2`;
}

// ［終電を調べる］の出し分け。url があればリンク、なければ足りない入れ場所を返す。
// needVenueStation → 編集の画面、needHome → 設定の画面へのリンクを出す。
// 日付だけ不正で url が null のときは、駅は足りているのでどちらも false。
export function lastTrainState(live, homeStation) {
  return {
    url: lastTrainUrl(live, homeStation),
    needVenueStation: !normalizeStation(live?.venue_station),
    needHome: !normalizeStation(homeStation),
  };
}
