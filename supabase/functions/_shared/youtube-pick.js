import { normalizeName, titleKey } from './normalize.js';

const SHORT_SEC = 60;

// 別バージョンを示す言葉（NFKC・小文字で比べる）。曲名そのものに入っている言葉は、別バージョン扱いしない。
const VARIANT_WORDS = [
  'vocal only', 'off vocal', 'on vocal', 'instrumental', 'inst', 'karaoke', 'ニコカラ', 'live', 'ライブ',
  '弾き語り', 'cover', 'カバー', '歌ってみた', 'short', '#shorts', '切り抜き', 'remix',
];

const lower = (s) => String(s ?? '').normalize('NFKC').toLowerCase();

function isVariant(title, trackTitle) {
  const t = lower(title);
  const own = lower(trackTitle);
  return VARIANT_WORDS.some((w) => {
    if (own.includes(w)) return false;
    if (/^[a-z#]+( [a-z]+)*$/.test(w)) return new RegExp(`(^|[^a-z])${w.replace('#', '#?')}([^a-z]|$)`).test(t);
    return t.includes(w);
  });
}

// 「X - Topic」の X。Topic チャンネルでなければ null。
function topicArtist(channelTitle) {
  const m = /^(.*?)\s*[-–—]\s*topic\s*$/i.exec(String(channelTitle ?? '').normalize('NFKC').trim());
  return m ? m[1] : null;
}

// 検索結果から1本選ぶ（設計 4.4）。items：{ videoId, title, channelTitle, durationSec? }[]。空なら null。
// 1. 60秒以下（ショート・切り抜き）を除く（再生時間がわかるときだけ）
// 2. 曲名が同じ「<同じアーティスト> - Topic」
// 3. チャンネル名にアーティスト名を含み、曲名を含む、別バージョンでない動画（official を優先）
// 4. 曲名を含む、別バージョンでない動画
// 5. 残りの先頭
export function pickVideo(items, artistName, trackTitle = '') {
  if (!Array.isArray(items)) return null;
  const list = items.filter((it) => !(Number.isFinite(it.durationSec) && it.durationSec <= SHORT_SEC));
  if (list.length === 0) return null;
  const artist = normalizeName(artistName);
  const track = normalizeName(trackTitle);
  const wanted = titleKey(trackTitle);

  if (artist && wanted) {
    const topics = list.filter((it) => topicArtist(it.channelTitle) !== null && titleKey(it.title) === wanted);
    const sameArtist = (x) => {
      const n = normalizeName(x);
      if (!n) return false;
      if (n === artist) return true;
      // 日本語名のアーティストのローマ字の Topic：同じ結果の中に、アーティスト名とそのローマ字を両方含むチャンネルがあるか。
      return list.some((o) => {
        const c = normalizeName(o.channelTitle);
        return c.includes(artist) && c.includes(n);
      });
    };
    const ok = topics.filter((it) => sameArtist(topicArtist(it.channelTitle)));
    const exact = ok.find((it) => normalizeName(topicArtist(it.channelTitle)) === artist);
    if (exact || ok[0]) return exact ?? ok[0];
  }

  const plain = list.filter((it) => !isVariant(it.title, trackTitle));
  const hasTrack = (it) => track && normalizeName(it.title).includes(track);
  const official = (it) => /official|公式/.test(lower(it.title));
  const byOfficial = (a, b) => Number(official(b)) - Number(official(a));
  if (artist && track) {
    const c = plain.filter((it) => normalizeName(it.channelTitle).includes(artist) && hasTrack(it)).sort(byOfficial);
    if (c[0]) return c[0];
  }
  if (track) {
    const c = plain.filter(hasTrack).sort(byOfficial);
    if (c[0]) return c[0];
  }
  return list[0];
}
