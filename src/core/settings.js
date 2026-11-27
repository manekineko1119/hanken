// 設定の画面の判断（純粋）。
// 前後の空白（全角を含む）を取り、空なら null。「駅」は付け足しも取りもしない（打った通りに残す）。
export function cleanHomeStation(value) {
  if (typeof value !== 'string') return null;
  const s = value.replace(/^[\s　]+|[\s　]+$/g, '');
  return s === '' ? null : s;
}
