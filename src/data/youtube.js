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

// Google から戻ったあと、保留の鍵を自分のつながりとして確定する。{ returnTo, channelTitle }。
// 失敗したら code（WRONG_USER・EXPIRED など）を持つ Error を投げる。
export async function finishConnect(pendingId) {
  let res;
  try { res = await getClient().functions.invoke('yt-connect-finish', { body: { pendingId } }); } catch { res = { error: {} }; }
  if (!res.error) return res.data;
  let code;
  try { code = (await res.error.context?.json?.())?.error?.code; } catch { code = undefined; }
  throw Object.assign(new Error(FAILED), { code });
}

export async function disconnect() {
  await invoke('yt-disconnect', {});
}
