// YouTube のつながりの判断（DOM なし）。つないでから7日で切れる。
const DAY_MS = 86400000;
const LIFETIME_DAYS = 7;

export function daysLeft(connectedAt, now) {
  const start = Date.parse(connectedAt);
  if (Number.isNaN(start)) return 0;
  const left = Math.ceil((LIFETIME_DAYS * DAY_MS - (now.getTime() - start)) / DAY_MS);
  return Math.min(LIFETIME_DAYS, Math.max(0, left));
}
