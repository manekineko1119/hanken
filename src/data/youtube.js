// YouTube のつながり（Edge Function とステータスの RPC）。薄く保つ。
import { getClient } from '../auth/auth.js';

const FAILED = 'YOUTUBE_FAILED';

async function invoke(name, body) {
  let res;
  try { res = await getClient().functions.invoke(name, { body }); } catch { res = { error: {} }; }
  if (res.error) throw new Error(FAILED);
  return res.data;
}

// { connected, channelTitle, connectedAt }
export async function getStatus() {
  const { data, error } = await getClient().rpc('youtube_connection_status');
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return {
    connected: !!row?.connected,
    channelTitle: typeof row?.channel_title === 'string' ? row.channel_title : '',
    connectedAt: row?.connected_at ?? null,
  };
}

// returnTo は '#/settings' のようなアプリ内のハッシュ。サーバーが返した URL へブラウザごと移る。
export async function connect(returnTo) {
  const data = await invoke('yt-connect-start', { returnTo });
  if (typeof data?.url !== 'string' || !data.url) throw new Error(FAILED);
  location.assign(data.url);
}

export async function disconnect() {
  await invoke('yt-disconnect', {});
}
