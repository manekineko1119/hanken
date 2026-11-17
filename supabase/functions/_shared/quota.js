// YouTube の枠と、一人あたりの上限（設計 7.1・7.2）。
export const LIMITS = { save: 5, search: 30, setlist: 20, globalSearch: 90 };

function dayIn(timeZone, now) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export const ptDay = (now) => dayIn('America/Los_Angeles', now);
export const jstDay = (now) => dayIn('Asia/Tokyo', now);

export function estimateSaveUnits({ existingItems, count, isNew }) {
  return isNew ? 50 + 50 * count : 50 * existingItems + 50 * count + 1;
}

export function canSpend(used, estimate, cap = 9500) {
  return used + estimate <= cap;
}
