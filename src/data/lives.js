// ライブの保存・読み込み（Supabase）。薄く保つ。判断は src/core/ に置く。
import { getClient } from '../auth/auth.js';
import { planArtistChanges } from '../core/live-form.js';

function check({ error }) {
  if (error) throw error;
}

// 日付の昇順で返す。upcoming/past の並びは core/lives.js の splitLives が決める（past は降順）。
export async function listLives() {
  const { data, error } = await getClient()
    .from('lives')
    .select('id, date, venue, title, memo, venue_address, venue_station, access_memo, last_train_memo, afterparty_memo, impression, artists:live_artists(id, name, itunes_artist_id, position)')
    .order('date', { ascending: true });
  if (error) throw error;
  for (const l of data) l.artists.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  return data;
}

export async function getLive(id) {
  const { data, error } = await getClient()
    .from('lives')
    .select('id, date, venue, title, memo, venue_address, venue_station, access_memo, last_train_memo, afterparty_memo, impression, artists:live_artists(id, name, itunes_artist_id, position)')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  if (data) data.artists.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  return data;
}

// upsert は使わない（設計 5.2）。出演者は差分で保存する（行を消して入れ直すと、プレイリストが cascade で消える）。
// 新規 live の作成後に失敗したら、err.liveId に id を付ける（画面は update として再試行できる）。
// loadedIds：編集の画面を開いたときの出演者の id。消すのはこの中だけ（core/live-form.js の planArtistChanges）。
export async function saveLive(live, artists, loadedIds = null) {
  const db = getClient();
  const fields = {
    date: live.date,
    venue: live.venue ?? null,
    title: live.title ?? null,
    memo: live.memo ?? null,
    venue_address: live.venue_address ?? null,
    venue_station: live.venue_station ?? null,
    access_memo: live.access_memo ?? null,
    last_train_memo: live.last_train_memo ?? null,
    afterparty_memo: live.afterparty_memo ?? null,
    impression: live.impression ?? null,
  };
  let id = live.id;
  if (id) {
    check(await db.from('lives').update(fields).eq('id', id));
  } else {
    const { data, error } = await db.from('lives').insert(fields).select('id').single();
    if (error) throw error;
    id = data.id;
  }
  try {
    const { data: existing, error } = await db.from('live_artists').select('id, name, position').eq('live_id', id);
    if (error) throw error;
    const plan = planArtistChanges(existing, artists, loadedIds);
    if (plan.deletes.length) check(await db.from('live_artists').delete().in('id', plan.deletes));
    for (const { id: artistId, ...rest } of plan.updates) {
      check(await db.from('live_artists').update(rest).eq('id', artistId));
    }
    if (plan.inserts.length) {
      check(await db.from('live_artists').insert(plan.inserts.map((r) => ({ live_id: id, ...r }))));
    }
  } catch (err) {
    err.liveId = id;
    throw err;
  }
  return id;
}

export async function deleteLive(id) {
  check(await getClient().from('lives').delete().eq('id', id));
}

// 出演者ごとの予習・セトリの状態。行がなければ 'none'。
export async function getPlaylistStatuses(liveId) {
  const { data, error } = await getClient()
    .from('playlists')
    .select('live_artist_id, kind, status')
    .eq('live_id', liveId);
  if (error) throw error;
  const map = new Map();
  for (const r of data) {
    if (!r.live_artist_id) continue;
    const cur = map.get(r.live_artist_id) ?? { prep: 'none', setlist: 'none' };
    if (r.kind === 'prep' || r.kind === 'setlist') cur[r.kind] = r.status;
    map.set(r.live_artist_id, cur);
  }
  return map;
}

// 別の iTunes アーティストを選んだとき、出演者に覚えさせる。
export async function setArtistItunesId(liveArtistId, itunesArtistId) {
  check(await getClient().from('live_artists').update({ itunes_artist_id: itunesArtistId }).eq('id', liveArtistId));
}
