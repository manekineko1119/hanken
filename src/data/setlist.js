// セトリ（ライブで実際に歌われた曲）の保存・読み取り（Supabase）。薄く保つ。判断は src/core/setlist.js。
// MC・アンコールなどの区切り（sections）は保存しない（privacy.html の記載どおり）。
import { getClient } from '../auth/auth.js';
import { callFunction, saveTracks } from './playlists.js';

// 画像から行を読む。{ lines } か、上限に届いたとき { limit: 'month' | 'day' }。ほかの失敗は例外。
export async function readSetlistImages(images) {
  const data = await callFunction('setlist-read', { images });
  if (data?.error === 'LIMIT') return { limit: data.scope };
  return { lines: data?.lines ?? [] };
}

// この出演者のセトリ。なければ null。
export async function findSetlist(liveArtistId) {
  const { data, error } = await getClient().from('playlists')
    .select('id, status').eq('kind', 'setlist').eq('live_artist_id', liveArtistId).maybeSingle();
  if (error) throw error;
  return data ?? null;
}

// セトリを作る（status は DB の既定の draft）。曲の保存に失敗したら、作った行を消す。
export async function createSetlist({ liveId, liveArtistId, artistName, title, tracks }) {
  const db = getClient();
  const { data, error } = await db.from('playlists').insert({
    kind: 'setlist', live_id: liveId ?? null, live_artist_id: liveArtistId, artist_name: artistName, title,
  }).select('id').single();
  if (error) throw error;
  try {
    if (tracks.length) await saveTracks(data.id, tracks, []);
  } catch (err) {
    await db.from('playlists').delete().eq('id', data.id);
    throw err;
  }
  return data.id;
}

// セトリの曲を丸ごと置き換える。
export function replaceSetlistTracks(id, tracks) {
  return saveTracks(id, tracks, []);
}
