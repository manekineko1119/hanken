// YouTube のつながりの判断（DOM なし）。つないでから7日で切れる。
const DAY_MS = 86400000;
const LIFETIME_DAYS = 7;

export function daysLeft(connectedAt, now) {
  const start = Date.parse(connectedAt);
  if (Number.isNaN(start)) return 0;
  const left = Math.ceil((LIFETIME_DAYS * DAY_MS - (now.getTime() - start)) / DAY_MS);
  return Math.min(LIFETIME_DAYS, Math.max(0, left));
}

// Google から戻ったときの「確定する保留」の id（#/settings?yt=finish&p=…）。なければ null。
export function pendingIdOf(query) {
  return query?.yt === 'finish' && typeof query.p === 'string' && query.p ? query.p : null;
}

// 確定（yt-connect-finish）に失敗したときの文。
export function finishErrorText(code) {
  if (code === 'WRONG_USER') return 'ほかのアカウントで始めたつなぎ方でした。この画面から、もう一度つないでください';
  if (code === 'EXPIRED') return '時間が切れました。もう一度つないでください';
  return 'YouTube につなげませんでした。もう一度試してください';
}
