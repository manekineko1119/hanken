import { normalizeName } from './normalize.js';

// この値より低い確かさの行は「要確認」にする。
export const UNCERTAIN_BELOW = 0.8;

// 行全体がこれに一致するときだけ区切り（normalizeName でそろえたもの）。
const SECTION_WORDS = new Set([
  'mc', 'se', 'en', 'encore', 'アンコール', 'wen', 'wencore', 'wアンコール',
  'ダブルアンコール', '転換',
]);

// 行頭の番号：1. / 01 / 1) / １． / ① / M1 / M-1.（全角・空白あり）。
const NUMBER_PREFIX = [
  /^[\u2460-\u2473\u3251-\u325F\u32B1-\u32BF]\s*/,
  /^[MＭmｍ]\s*[-－ー]?\s*[0-9０-９]+(?:\s*[.．)）、:：]\s*|\s+)/,
  /^[0-9０-９]{1,3}(?:\s*[.．)）、:：]\s*|\s+)/,
];

function stripNumber(s) {
  for (const re of NUMBER_PREFIX) {
    const rest = s.replace(re, '');
    if (rest !== s && rest.trim()) return rest.trim();
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
    const text = stripNumber(raw);
    const key = normalizeName(text);
    if (!key) continue; // 記号だけの行
    if (SECTION_WORDS.has(key)) {
      sections.push({ before_index: songs.length, label: text });
      continue;
    }
    const c = line.confidence;
    songs.push({ title: text, uncertain: typeof c === 'number' && c < UNCERTAIN_BELOW });
  }
  return { songs, sections };
}

export function toSetlistTracks(songs, artistName) {
  return songs.map((s) => ({
    title: s.title, artistName, source: 'setlist', isLatest: false, uncertain: !!s.uncertain,
  }));
}
