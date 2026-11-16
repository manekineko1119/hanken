// 予習を作る流れ（画面から呼ぶ）。判断は core/prep.js、通信は Edge Function と data/playlists.js。
import { getClient } from '../auth/auth.js';
import { orderArtists, pickArtist, buildInitialTracks } from '../core/prep.js';
import { playlistTitle } from '../core/naming.js';
import { createPrepDraft } from '../data/playlists.js';
import { setArtistItunesId } from '../data/lives.js';

export const CONTEXT_KEY = 'liveapp.prepContext';
const MESSAGES = {
  NOT_ALLOWED: 'この操作はできません。ログインし直してください',
  BAD_INPUT: '入力を確かめてください',
  UPSTREAM: '曲の情報を取れませんでした。通信を確かめて、もう一度試してください',
};
export const NOT_FOUND = 'iTunes で見つかりませんでした。名前を確かめてください';

export function saveContext(c) {
  try { sessionStorage.setItem(CONTEXT_KEY, JSON.stringify(c)); } catch { /* 保存できなくても進める */ }
}
export function clearContext() {
  try { sessionStorage.removeItem(CONTEXT_KEY); } catch { /* 消せなくても進める */ }
}
export function loadContext() {
  try {
    const c = JSON.parse(sessionStorage.getItem(CONTEXT_KEY));
    return c && typeof c.name === 'string' ? c : null;
  } catch { return null; }
}

// 失敗は Error(message=画面に出す文) にして投げる。
export async function call(name, body) {
  let res;
  try { res = await getClient().functions.invoke(name, { body }); } catch { res = { error: {} }; }
  if (!res.error) return res.data;
  let code = 'UPSTREAM';
  try { code = (await res.error.context.json())?.error?.code ?? 'UPSTREAM'; } catch { /* 通信の失敗 */ }
  throw new Error(MESSAGES[code] ?? MESSAGES.UPSTREAM);
}

// { status: 'created', id } | { status: 'pick' } | { status: 'none' }
export async function startPrep(c) {
  const { candidates } = await call('artist-search', { name: c.name });
  if (!candidates?.length) return { status: 'none' };
  const hit = pickArtist(c.name, candidates);
  if (!hit) return { status: 'pick' };
  return { status: 'created', id: await createFor(c, hit.id) };
}

export async function orderedCandidates(name) {
  const { candidates } = await call('artist-search', { name });
  return orderArtists(name, candidates ?? []);
}

export async function createFor(c, itunesArtistId) {
  const cands = await call('track-candidates', { artistName: c.name, itunesArtistId });
  const { tracks, rest } = buildInitialTracks({ popular: cands.popular ?? [], recent: cands.recent ?? [] }, c.name);
  const title = playlistTitle({ kind: 'prep', artistName: c.name, date: c.date, venue: c.venue });
  try {
    const id = await createPrepDraft({
      liveId: c.liveId, liveArtistId: c.liveArtistId, artistName: c.name, itunesArtistId, tracks, rest, title,
    });
    clearContext();
    if (c.liveArtistId) await setArtistItunesId(c.liveArtistId, itunesArtistId).catch(() => {}); // 覚えられなくても作れている
    return id;
  } catch {
    throw new Error('保存できませんでした。通信を確かめてください');
  }
}

// 「作る」を押したあとの共通の動き。画面が切り替わっていたら何もしない。
export async function runStart(c, ctx, { button, msg }) {
  button.disabled = true;
  msg.hidden = true;
  saveContext(c);
  let r;
  try {
    r = await startPrep(c);
  } catch (err) {
    if (!ctx.alive()) return;
    msg.textContent = err.message;
    msg.hidden = false;
    button.disabled = false;
    return;
  }
  if (!ctx.alive()) return;
  if (r.status === 'created') location.hash = `#/playlist/${encodeURIComponent(r.id)}`;
  else if (r.status === 'pick') location.hash = '#/artist-pick';
  else {
    msg.textContent = NOT_FOUND;
    msg.hidden = false;
    button.disabled = false;
  }
}
