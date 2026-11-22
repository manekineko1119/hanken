import { normalizeName } from './normalize.js';

// この値より低い確かさの行は「要確認」にする。
export const UNCERTAIN_BELOW = 0.8;

// 行全体がこれに一致するときだけ区切り（normalizeName でそろえたもの）。
const SECTION_WORDS = new Set([
  'mc', 'se', 'en', 'encore', 'アンコール', 'wen', 'wencore', 'wアンコール',
  'ダブルアンコール', '転換',
]);

// 行頭の番号（記号付き）：1. / 1) / １． / ① / M1 / M-1.（全角・空白あり）。いつも除く。
const MARKED_PREFIX = [
  /^[①-⑳㉑-㉟㊱-㊿]\s*/,
  /^[MＭmｍ]\s*[-－ー]?\s*[0-9０-９]+(?:\s*[.．)）、:：]\s*|\s+|$)/,
  /^[0-9０-９]{1,3}\s*[.．)）、:：]\s*/,
];
// 数字と空白だけの番号（01 曲A）。曲名の一部のこともあるので、曲の順番と同じ数のときだけ除く。
const BARE_PREFIX = /^([0-9０-９]{1,3})\s+/;

// 番号だけの行は ''（読み飛ばす）。
function stripNumber(s, position) {
  for (const re of MARKED_PREFIX) {
    if (re.test(s)) return s.replace(re, '').trim();
  }
  const m = s.match(BARE_PREFIX);
  if (m && Number(m[1].normalize('NFKC')) === position) {
    const rest = s.slice(m[0].length).trim();
    if (rest) return rest;
  }
  return s;
}

// 貼り付けた文字を行に分ける（空行も残す）。
export function linesFromText(text) {
  return String(text ?? '').split(/\r\n|\n|\r/).map((t) => ({ text: t }));
}

// 読めた行を曲と区切りに整える。区切りの before_index は、次の曲の songs の位置。
export function toSetlist(lines) {
  const songs = [];
  const sections = [];
  for (const line of lines) {
    const raw = String(line?.text ?? '').trim();
    if (!raw) continue;
    const text = stripNumber(raw, songs.length + 1);
    const key = normalizeName(text);
    if (!key) continue; // 記号だけの行・番号だけの行
    // EN1・MC② のように末尾に番号が付いた区切りも区切り。
    if (SECTION_WORDS.has(key) || SECTION_WORDS.has(key.replace(/[0-9]+$/, ''))) {
      sections.push({ before_index: songs.length, label: text });
      continue;
    }
    const c = line.confidence;
    songs.push({ title: text, uncertain: typeof c === 'number' && !(Number.isFinite(c) && c >= UNCERTAIN_BELOW) });
  }
  return { songs, sections };
}

export function toSetlistTracks(songs, artistName) {
  return songs.map((s) => ({
    title: s.title, artistName, source: 'setlist', isLatest: false, uncertain: !!s.uncertain,
  }));
}
