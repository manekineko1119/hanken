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
// loadedIds（編集の画面を開いたときに読んだ出演者の id）を渡すと、消すのはその中だけにする。
// 画面を開いたあとに別の端末で足された出演者（と、その予習）を消さないため。
export function planArtistChanges(existing, next, loadedIds = null) {
  const known = new Set(existing.map((e) => e.id));
  const cleaned = (next ?? [])
    .map((n) => ({ ...n, name: String(n?.name ?? '').trim() }))
    .filter((n) => n.name);
  const updates = [];
  const inserts = [];
  const kept = new Set();
  const newIds = new Set();
  cleaned.forEach((n, position) => {
    const extra = n.itunes_artist_id === undefined ? {} : { itunes_artist_id: n.itunes_artist_id };
    if (n.id && known.has(n.id) && !kept.has(n.id)) {
      kept.add(n.id);
      updates.push({ id: n.id, name: n.name, position, ...extra });
    } else {
      // 画面で付けた新しい id（まだ DB にない）は、そのまま使う。返事が届かずにもう一度押しても、
      // 同じ id なので2回目は update になり、二重にならない。
      const own = n.id && !known.has(n.id) && !newIds.has(n.id) ? { id: n.id } : {};
      if (own.id) newIds.add(own.id);
      inserts.push({ ...own, name: n.name, position, ...extra });
    }
  });
  const removable = loadedIds ? new Set(loadedIds) : null;
  const deletes = existing.filter((e) => !kept.has(e.id) && (!removable || removable.has(e.id))).map((e) => e.id);
  return { updates, deletes, inserts };
}

// 新しい出演者には、画面で id を付けておく（保存の返事が届かずにもう一度押しても、二重にしない）。
// この画面で作った id は ownIds に覚え、消してよい行に含める（返事が届かずに DB に入った行も、フォームから外せば消える）。
const ownIds = new WeakMap(); // state → Set
export function newArtist(state) {
  const a = { id: globalThis.crypto.randomUUID(), name: '', original: null };
  if (state) {
    if (!ownIds.has(state)) ownIds.set(state, new Set());
    ownIds.get(state).add(a.id);
  }
  return a;
}
// 消してよい出演者の id：開いたときに読んだもの＋この画面で作ったもの。新しいライブは null（差分で全部見る）。
export function deletableIds(state) {
  if (!state.loadedIds) return null;
  return [...state.loadedIds, ...(ownIds.get(state) ?? [])];
}

// 会場ごとに変わらない項目。前の同じ会場のライブから写す。
export const VENUE_COPY_KEYS = ['venue_address', 'venue_station', 'access_memo', 'last_train_memo'];

const blank = (v) => String(v ?? '').trim() === '';

// 会場名の候補：空でない会場名を、新しい日付の順に重なりなしで返す（前後の空白は除いて比べる）。
export function venueSuggestions(lives, excludeId = null) {
  const sorted = (lives ?? [])
    .filter((l) => !(excludeId != null && l.id === excludeId))
    .sort((a, b) => String(b.date ?? '').localeCompare(String(a.date ?? '')));
  const seen = new Set();
  const out = [];
  for (const l of sorted) {
    const v = String(l.venue ?? '').trim();
    if (v && !seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  return out;
}

// 同じ会場名で日付が一番新しいライブ（自分自身は除く）から、state で空の欄だけ写す。写したキーを返す。
export function copyFromPastVenue(state, lives, venue) {
  const name = String(venue ?? '').trim();
  if (!name) return [];
  const source = (lives ?? [])
    .filter((l) => l.id !== state.id && String(l.venue ?? '').trim() === name)
    .sort((a, b) => String(b.date ?? '').localeCompare(String(a.date ?? '')))[0];
  if (!source) return [];
  const copied = [];
  for (const key of VENUE_COPY_KEYS) {
    if (blank(state[key]) && !blank(source[key])) {
      state[key] = source[key];
      copied.push(key);
    }
  }
  return copied;
}
