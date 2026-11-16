// ライブの入力の確かめ。
export function validateLive(input) {
  const errors = {};
  if (!input?.date) errors.date = '日付を入れてください';
  const names = (input?.artists ?? []).map((a) => String(a?.name ?? '').trim()).filter(Boolean);
  if (names.length === 0) errors.artists = '出演者を1組以上入れてください';
  return { ok: Object.keys(errors).length === 0, errors };
}

// 出演者の保存の差分。既存の行（id）を残して、更新・削除・追加に分ける。
// 行を消して入れ直すと、出演者につくプレイリストが cascade で消えるため。
export function planArtistChanges(existing, next) {
  const known = new Set(existing.map((e) => e.id));
  const cleaned = (next ?? [])
    .map((n) => ({ ...n, name: String(n?.name ?? '').trim() }))
    .filter((n) => n.name);
  const updates = [];
  const inserts = [];
  const kept = new Set();
  cleaned.forEach((n, position) => {
    const extra = n.itunes_artist_id === undefined ? {} : { itunes_artist_id: n.itunes_artist_id };
    if (n.id && known.has(n.id) && !kept.has(n.id)) {
      kept.add(n.id);
      updates.push({ id: n.id, name: n.name, position, ...extra });
    } else {
      inserts.push({ name: n.name, position, ...extra });
    }
  });
  const deletes = existing.filter((e) => !kept.has(e.id)).map((e) => e.id);
  return { updates, deletes, inserts };
}
