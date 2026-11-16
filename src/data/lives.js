// ライブの保存・読み込み（Supabase）。薄く保つ。判断は src/core/ に置く。
import { getClient } from '../auth/auth.js';

function check({ error }) {
  if (error) throw error;
}

export async function listLives() {
  const { data, error } = await getClient()
    .from('lives')
    .select('id, date, venue, title, memo, artists:live_artists(id, name, itunes_artist_id, position)')
    .order('date', { ascending: true });
  if (error) throw error;
  for (const l of data) l.artists.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  return data;
}

export async function getLive(id) {
  const { data, error } = await getClient()
    .from('lives')
    .select('id, date, venue, title, memo, artists:live_artists(id, name, itunes_artist_id, position)')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  if (data) data.artists.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  return data;
}

// upsert は使わない（設計 5.2）。live を insert か update したあと、出演者を入れ替える。
export async function saveLive(live, artists) {
  const db = getClient();
  const fields = { date: live.date, venue: live.venue ?? null, title: live.title ?? null, memo: live.memo ?? null };
  let id = live.id;
  if (id) {
    check(await db.from('lives').update(fields).eq('id', id));
  } else {
    const { data, error } = await db.from('lives').insert(fields).select('id').single();
    if (error) throw error;
    id = data.id;
  }
  check(await db.from('live_artists').delete().eq('live_id', id));
  const rows = artists
    .map((a) => ({ name: String(a.name ?? '').trim(), itunes_artist_id: a.itunes_artist_id ?? null }))
    .filter((a) => a.name)
    .map((a, position) => ({ live_id: id, ...a, position }));
  if (rows.length) check(await db.from('live_artists').insert(rows));
  return id;
}

export async function deleteLive(id) {
  check(await getClient().from('lives').delete().eq('id', id));
}
