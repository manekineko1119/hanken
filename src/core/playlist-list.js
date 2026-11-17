// プレイリストの一覧：並び替え・絞り込み・YouTube への反映の判定。どれも画面や通信に頼らない。
const byText = (get, dir) => (x, y) => {
  const p = get(x), q = get(y);
  return p < q ? -dir : p > q ? dir : 0;
};

// sort：'newest'（既定）・'oldest'・'live-date'（ライブの日付が早い順。ライブなしは最後）。元の配列は変えない。
export function sortPlaylists(items, sort) {
  const list = [...items];
  if (sort === 'oldest') return list.sort(byText((p) => p.createdAt, 1));
  if (sort === 'live-date') {
    return list.sort((x, y) => {
      const p = x.live?.date ?? null, q = y.live?.date ?? null;
      if (p === q) return byText((r) => r.createdAt, -1)(x, y);
      if (p === null) return 1;
      if (q === null) return -1;
      return p < q ? -1 : 1;
    });
  }
  return list.sort(byText((p) => p.createdAt, -1));
}

// status：'all'・'saved'・'draft'。text：アーティスト名かタイトルに含まれる文字（大文字小文字は区別しない）。
export function filterPlaylists(items, { status = 'all', text = '' } = {}) {
  const q = String(text).trim().toLowerCase();
  return items.filter((p) => (status === 'all' || p.status === status)
    && (!q || `${p.title}\n${p.artistName}`.toLowerCase().includes(q)));
}

// 保存済みで、保存のあとに曲を変えた（YouTube Music にまだ反映していない）か。
export function needsReflect({ status, savedAt, editedAt }) {
  if (status !== 'saved') return false;
  const edited = Date.parse(editedAt);
  if (Number.isNaN(edited)) return false;
  const saved = Date.parse(savedAt);
  return Number.isNaN(saved) || edited > saved;
}

export function youtubeMusicUrl(youtubePlaylistId) {
  return youtubePlaylistId ? `https://music.youtube.com/playlist?list=${encodeURIComponent(youtubePlaylistId)}` : null;
}
