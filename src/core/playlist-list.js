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

// kind：'all'・'prep'（予習）・'setlist'（セトリ）。text：アーティスト名かタイトルに含まれる文字（大文字小文字は区別しない）。
export function filterPlaylists(items, { kind = 'all', text = '' } = {}) {
  const q = String(text).trim().toLowerCase();
  return items.filter((p) => (kind === 'all' || p.kind === kind)
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

const SORT_KEYS = ['newest', 'oldest', 'live-date'];
const KIND_KEYS = ['all', 'prep', 'setlist'];

// 覚えていた並び方・絞り込みを直す。古い形（status など）や壊れた値は、既定に戻す。
export function normalizePref(v) {
  const o = v && typeof v === 'object' ? v : {};
  return {
    sort: SORT_KEYS.includes(o.sort) ? o.sort : 'newest',
    kind: KIND_KEYS.includes(o.kind) ? o.kind : 'all',
    text: typeof o.text === 'string' ? o.text.slice(0, 100) : '',
  };
}

// プレイリストを消す前の確認の文。消すのはアプリの記録だけ（YouTube 上のプレイリストは消さない）。
export function deleteConfirmText({ title, youtubePlaylistId }) {
  const head = `「${title}」を消しますか？消すと元に戻せません。`;
  return youtubePlaylistId ? `${head}YouTube に保存したプレイリストは残ります（消したいときは YouTube で消してください）。` : head;
}
