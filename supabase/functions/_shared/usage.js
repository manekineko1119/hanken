// YouTube の枠と、一人あたりの検索回数の数え方（設計 7.1・7.2）。
// api_usage は太平洋時間の日付、user_daily_usage は日本時間の日付で数える。
// service role の db を渡す。Deno 固有の API は使わない。
import { ptDay, jstDay } from './quota.js';

function fail(message) {
  const e = new Error(message);
  e.code = 'UPSTREAM';
  return e;
}

// 今日の検索回数：{ user（この人・日本時間）, global（全員・太平洋時間）, units }
export async function getSearchUsage(db, userId, now) {
  const u = await db.from('user_daily_usage').select('count').eq('user_id', userId).eq('day_jst', jstDay(now)).eq('kind', 'search').maybeSingle();
  if (u.error) throw fail('使った回数を確かめられませんでした');
  const g = await db.from('api_usage').select('units, searches').eq('day_pt', ptDay(now)).maybeSingle();
  if (g.error) throw fail('使った回数を確かめられませんでした');
  return { user: u.data?.count ?? 0, global: g.data?.searches ?? 0, units: g.data?.units ?? 0 };
}

// 検索を1回数える（呼ぶ前に数える。失敗しても Google 側では使われているため）。
// usage は getSearchUsage の結果。戻り値は、数えたあとの { user, global, units }。
export async function recordSearch(db, userId, now, usage) {
  const user = usage.user + 1;
  const global = usage.global + 1;
  const r1 = await db.from('user_daily_usage').upsert({ user_id: userId, day_jst: jstDay(now), kind: 'search', count: user });
  const r2 = await db.from('api_usage').upsert({ day_pt: ptDay(now), units: usage.units, searches: global });
  if (r1.error || r2.error) throw fail('使った回数を記録できませんでした');
  return { user, global, units: usage.units };
}

// 検索以外の単位（videos.list など）を数える。
export async function recordUnits(db, now, usage, n) {
  const units = usage.units + n;
  const r = await db.from('api_usage').upsert({ day_pt: ptDay(now), units, searches: usage.global });
  if (r.error) throw fail('使った回数を記録できませんでした');
  return { ...usage, units };
}
