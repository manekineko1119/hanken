const PREFIX = { prep: '【予習】', setlist: '【セトリ】' };

// プレイリスト名。例：【予習】バンドA（2026-12-01 会場X）
export function playlistTitle({ kind, artistName, date, venue }) {
  const detail = [date, venue].filter(Boolean).join(' ');
  return `${PREFIX[kind] ?? ''}${artistName}${detail ? `（${detail}）` : ''}`;
}
