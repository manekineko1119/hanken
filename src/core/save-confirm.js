// 保存の確認の画面の判断（DOM なし）。画面に出す言葉は「曲」を使う（「動画」とは言わない）。
const NAME_MAX = 150; // サーバー（yt-save-playlist）の上限と同じ

const QUOTA_MESSAGE = '今日の YouTube の枠がいっぱいです。日本時間の17時ごろ（冬は17時、夏は16時）に戻ります';

const count = (n) => (Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);

// 曲（id・title）と、探した結果（id・videoId・videoTitle）を、見つかった曲と見つからなかった曲に分ける。順番は曲の並びのまま。
export function splitTracks(tracks, resolved) {
  const list = Array.isArray(tracks) ? tracks : [];
  const byId = new Map((Array.isArray(resolved) ? resolved : []).map((r) => [r?.id, r]));
  const found = [];
  const missing = [];
  for (const t of list) {
    const r = byId.get(t.id);
    if (r && r.videoId) found.push({ title: t.title, matchedTitle: r.videoTitle || t.title });
    else missing.push({ title: t.title });
  }
  return { found, missing };
}

export function saveSummary({ inserted, skipped } = {}) {
  const base = `${count(inserted)}曲を入れました`;
  const s = count(skipped);
  return s > 0 ? `${base}。${s}曲は見つからなかったので入れていません` : base;
}

// 保存の失敗：{ message, reconnect }。reconnect が true ならつなぐ流れへ進む。
export function saveErrorInfo(err) {
  const code = err?.code;
  if (code === 'YT_RECONNECT') {
    return { message: 'YouTube とのつながりが切れました。つなぎ直します', reconnect: true };
  }
  if (code === 'QUOTA') {
    return { message: typeof err.message === 'string' && err.message ? err.message : QUOTA_MESSAGE, reconnect: false };
  }
  if (code === 'UPSTREAM') {
    const n = count(err.inserted);
    const done = n > 0 ? `${n}曲まで入れたところで止まりました。` : '';
    return { message: `${done}YouTube で問題が起きました。もう一度「OK」を押すと、最初から入れ直します`, reconnect: false };
  }
  if (code === 'BAD_INPUT') {
    return { message: '入れられる曲がありません。先に曲を探してください', reconnect: false };
  }
  return { message: '保存できませんでした。通信を確かめて、もう一度押してください', reconnect: false };
}

export function resolveErrorInfo(err) {
  if (err?.code === 'QUOTA') return '今日はこれ以上曲を探せません。ここまでに見つかった曲だけ表示しています';
  return '曲を探せませんでした。通信を確かめて、もう一度試してください';
}

// プレイリスト名：前後の空白を除く。空・長すぎは null（保存させない）。
export function cleanName(s) {
  const t = String(s ?? '').trim();
  return t && t.length <= NAME_MAX ? t : null;
}

// つなぎ直したあとに確認の画面へ戻るハッシュ。
export function confirmReturnTo(id) {
  return `#/playlist/${encodeURIComponent(id)}?confirm=1`;
}
