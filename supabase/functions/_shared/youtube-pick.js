import { normalizeName } from './normalize.js';

// 検索結果から1本選ぶ（設計 4.4）：「<アーティスト名> - Topic」→ チャンネル名にアーティスト名を含む → 先頭。
// items：{ videoId, title, channelTitle }[]。空なら null。
export function pickVideo(items, artistName) {
  if (!Array.isArray(items) || items.length === 0) return null;
  const artist = normalizeName(artistName);
  if (artist) {
    const topic = items.find((it) => {
      const m = /^(.*?)\s*[-–—]\s*topic\s*$/i.exec(String(it.channelTitle ?? '').normalize('NFKC').trim());
      return m && normalizeName(m[1]) === artist;
    });
    if (topic) return topic;
    const official = items.find((it) => normalizeName(it.channelTitle).includes(artist));
    if (official) return official;
  }
  return items[0];
}
