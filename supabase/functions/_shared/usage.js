// YouTube の枠と、一人あたりの検索回数の数え方（設計 7.1・7.2）。
// api_usage は太平洋時間の日付、user_daily_usage は日本時間の日付で数える。
// 足し算は SQL の関数 increment_usage の中で行う（同時に呼ばれても数えもれしない）。
// service role の db を渡す。Deno 固有の API は使わない。
import { ptDay, jstDay } from './quota.js';

function fail(message) {
  const e = new Error(message);
  e.code = 'UPSTREAM';
  return e;
}

// 今日の検索回数（読むだけ）：{ user（この人・日本時間）, global（全員・太平洋時間）, units }
export async function getSearchUsage(db, userId, now) {
  const u = await db.from('user_daily_usage').select('count').eq('user_id', userId).eq('day_jst', jstDay(now)).eq('kind', 'search').maybeSingle();
  if (u.error) throw fail('使った回数を確かめられませんでした');
  const g = await db.from('api_usage').select('units, searches').eq('day_pt', ptDay(now)).maybeSingle();
  if (g.error) throw fail('使った回数を確かめられませんでした');
  return { user: u.data?.count ?? 0, global: g.data?.searches ?? 0, units: g.data?.units ?? 0 };
}

// 検索の回数と単位を足し、足したあとの { user, global, units } を返す。searches に -1 を渡すと戻せる。
// kind が 'search' 以外（'save' など）のときは、一人あたりの回数と単位だけを足す（検索の枠は増やさない）。
export async function incrementUsage(db, userId, now, { searches = 0, units = 0, kind = 'search' } = {}) {
  const { data, error } = await db.rpc('increment_usage', {
    p_user_id: userId, p_day_jst: jstDay(now), p_day_pt: ptDay(now), p_kind: kind,
    p_searches: searches, p_units: units,
  });
  const row = Array.isArray(data) ? data[0] : data;
  if (error || !row) throw fail('使った回数を記録できませんでした');
  return { user: row.user_count, global: row.global_searches, units: row.global_units };
}
