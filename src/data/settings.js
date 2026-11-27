// 設定（user_settings）の読み書き。薄く保つ。判断は src/core/settings.js に置く。
// 行は RLS で自分のものだけに絞られる（user_id は auth.uid() が既定）。
import { getClient } from '../auth/auth.js';
import { cleanHomeStation } from '../core/settings.js';

export async function getHomeStation() {
  const { data, error } = await getClient().from('user_settings').select('home_station').maybeSingle();
  if (error) throw error;
  return data?.home_station ?? null;
}

// upsert は使わない（設計 5.2）。自分の行があれば update、なければ insert。
export async function saveHomeStation(name) {
  const db = getClient();
  const home_station = cleanHomeStation(name);
  const { data, error } = await db.from('user_settings').select('user_id').maybeSingle();
  if (error) throw error;
  const res = data
    ? await db.from('user_settings').update({ home_station, updated_at: new Date().toISOString() }).eq('user_id', data.user_id)
    : await db.from('user_settings').insert({ home_station });
  if (res.error) throw res.error;
}
