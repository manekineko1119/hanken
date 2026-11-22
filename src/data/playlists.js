// プレイリストの保存・読み込み（Supabase）。薄く保つ。判断は src/core/ に置く。
import { getClient } from '../auth/auth.js';
import { unwrapResolve } from '../core/save-confirm.js';

const trackRow = (playlistId, t, i) => ({
  playlist_id: playlistId, position: i, title: t.title, artist_name: t.artistName,
  source: t.source, is_latest: !!t.isLatest, uncertain: !!t.uncertain,
});

const fromRow = (r) => ({ id: r.id, title: r.title, artistName: r.artist_name, source: r.source, isLatest: r.is_latest, uncertain: !!r.uncertain });

function check({ error }) {
  if (error) throw error;
}

export async function createPrepDraft({ liveId, liveArtistId, artistName, itunesArtistId, tracks, rest, title }) {
  const db = getClient();
  const { data, error } = await db.from('playlists').insert({
    kind: 'prep', live_id: liveId ?? null, live_artist_id: liveArtistId ?? null,
    artist_name: artistName, itunes_artist_id: itunesArtistId ?? null, title, candidates: rest,
  }).select('id').single();
  if (error) throw error;
  try {
    if (tracks.length) check(await db.from('playlist_tracks').insert(tracks.map((t, i) => trackRow(data.id, t, i))));
  } catch (err) {
    await db.from('playlists').delete().eq('id', data.id);
    throw err;
  }
  return data.id;
}

// アプリの記録だけを消す（曲の行は FK の cascade で消える）。YouTube 上のプレイリストは消さない。
export async function deletePlaylist(id) {
  check(await getClient().from('playlists').delete().eq('id', id));
}

// 名前だけを変える（YouTube にまだ保存していないプレイリスト用）。
export async function renamePlaylist(id, title) {
  check(await getClient().from("playlists").update({ title }).eq("id", id));
}

export async function getPlaylist(id) {
  const db = getClient();
  const { data, error } = await db.from('playlists')
    .select('id, kind, live_id, live_artist_id, artist_name, itunes_artist_id, title, status, candidates, saved_at, edited_at, youtube_playlist_id')
    .eq('id', id).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const res = await db.from('playlist_tracks')
    .select('id, title, artist_name, source, is_latest, uncertain, position').eq('playlist_id', id).order('position', { ascending: true });
  if (res.error) throw res.error;
  return { ...data, tracks: res.data.map(fromRow) };
}

// 曲を丸ごと入れ替える。DB の関数が1つのトランザクションで行う（途中で失敗しても元のまま）。
export async function saveTracks(id, tracks, rest) {
  check(await getClient().rpc('replace_playlist_tracks', {
    p_playlist_id: id,
    p_tracks: tracks.map((t, i) => ({
      position: i, title: t.title, artist_name: t.artistName, source: t.source, is_latest: !!t.isLatest, uncertain: !!t.uncertain,
    })),
    p_candidates: rest,
  }));
}

// 自分のプレイリストを全部（ライブの予習も、予習だけも。下書きも保存済みも）。並び替え・絞り込みは src/core/playlist-list.js。
export async function listPlaylists() {
  const { data, error } = await getClient().from('playlists')
    .select('id, kind, title, artist_name, status, youtube_playlist_id, created_at, live:lives(date, venue)')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data.map((p) => ({
    id: p.id, kind: p.kind, title: p.title, artistName: p.artist_name, status: p.status,
    youtubePlaylistId: p.youtube_playlist_id, createdAt: p.created_at,
    live: p.live ? { date: p.live.date, venue: p.live.venue } : null,
  }));
}

// ライブの出演者ごとの予習の id（なければ入っていない）。
export async function getPrepIds(liveId) {
  const { data, error } = await getClient().from('playlists')
    .select('id, live_artist_id').eq('live_id', liveId).eq('kind', 'prep');
  if (error) throw error;
  return new Map(data.filter((r) => r.live_artist_id).map((r) => [r.live_artist_id, r.id]));
}

// ライブの出演者ごとのセトリの id（なければ入っていない）。
export async function getSetlistIds(liveId) {
  const { data, error } = await getClient().from('playlists')
    .select('id, live_artist_id').eq('live_id', liveId).eq('kind', 'setlist');
  if (error) throw error;
  return new Map(data.filter((r) => r.live_artist_id).map((r) => [r.live_artist_id, r.id]));
}

// Edge Function を呼ぶ。失敗したら { code, message, ...本文のそのほか } を持つ Error を投げる（本文が読めなければ code なし）。
export async function callFunction(name, body) {
  let res;
  try {
    res = await getClient().functions.invoke(name, { body });
  } catch (e) {
    res = { error: e };
  }
  if (!res.error) return res.data;
  let payload = null;
  try { payload = await res.error.context?.json?.(); } catch { payload = null; }
  const { error: info, ...rest } = payload && typeof payload === 'object' ? payload : {};
  throw Object.assign(new Error(info?.message ?? 'FUNCTION_FAILED'), { ...rest, code: info?.code, message: info?.message ?? 'FUNCTION_FAILED' });
}

// 曲ごとに YouTube Music の曲を探す。{ tracks: [{ id, videoId, videoTitle }], searchesLeft }。
// 枠切れ（QUOTA）は、ここまでの結果を持つ Error（e.tracks）で返る。
export async function resolveVideos(playlistId) {
  return unwrapResolve(await callFunction('yt-resolve-videos', { playlistId }));
}

// YouTube に非公開で保存する。{ youtubePlaylistId, url, inserted, skipped }。
export function savePlaylist(playlistId, title) {
  return callFunction('yt-save-playlist', { playlistId, title });
}
