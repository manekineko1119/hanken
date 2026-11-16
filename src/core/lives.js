// ライブの一覧の分け方。日付は 'YYYY-MM-DD' の文字列で、辞書順に比べる。
const fmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Tokyo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export function todayJst(now) {
  return fmt.format(now);
}

export function splitLives(lives, today) {
  const upcoming = lives.filter((l) => l.date >= today).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const past = lives.filter((l) => l.date < today).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return { upcoming, past };
}

// '2026-12-01' -> '2026/12/01（火）'。形が違う値はそのまま返す（null は空）。
const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];
export function formatDateJa(date) {
  if (!date) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return String(date);
  const dow = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay();
  return `${m[1]}/${m[2]}/${m[3]}（${WEEKDAYS[dow]}）`;
}
