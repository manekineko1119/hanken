// 設定の画面の判断（純粋）。
// 前後の空白（全角を含む）を取り、空なら null。「駅」は付け足しも取りもしない（打った通りに残す）。
export function cleanHomeStation(value) {
  if (typeof value !== 'string') return null;
  const s = value.replace(/^[\s　]+|[\s　]+$/g, '');
  return s === '' ? null : s;
}

// 最寄り駅の読み込み結果から、欄の出し方を決める。
// undefined = 読み込みに失敗（欄も保存ボタンも出さない。空で保存して消してしまうのを防ぐ）。null = 読めて、未設定。
export function stationFieldState(loaded) {
  if (loaded === undefined) return { editable: false, value: '' };
  return { editable: true, value: loaded ?? '' };
}
