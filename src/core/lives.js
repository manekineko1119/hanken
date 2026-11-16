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
