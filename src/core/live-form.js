// ライブの入力の確かめ。
export function validateLive(input) {
  const errors = {};
  if (!input?.date) errors.date = '日付を入れてください';
  const names = (input?.artists ?? []).map((a) => String(a?.name ?? '').trim()).filter(Boolean);
  if (names.length === 0) errors.artists = '出演者を1組以上入れてください';
  return { ok: Object.keys(errors).length === 0, errors };
}
