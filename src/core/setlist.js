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
  /^[MＭmｍ]\s*[-－ー]?\s*[0-9０-９]+\s*[.．)）、:：]\s*/,
  /^[0-9０-９]{1,3}\s*[.．)）、:：]\s*/,
];
// 数字と空白だけの番号（01 曲A・M1 曲A）。曲名の一部のこともあるので、曲の順番と同じ数のときだけ除く。
const BARE_PREFIX = /^(?:[MＭmｍ]\s*[-－ー]?\s*)?([0-9０-９]{1,3})\s+/;

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

// アンコールの番号付きの曲（EN1 曲D・アンコール1 曲D・W.EN1 曲D・E1 曲D）。
const ENCORE_SONG = /^(W\.?\s*EN|WENCORE|ダブルアンコール|Wアンコール|アンコール|ENCORE|EN|E)\s*[-－ー]?\s*[0-9０-９]{1,2}(?:\s*[.．)）、:：]\s*|\s+)(.+)$/i;
// 空白だけが続く M 付きの番号（M1 曲A）。番号付きの曲の判定でだけ、順番に関係なく使う。
const M_SPACE = /^[MＭmｍ]\s*[-－ー]?\s*[0-9０-９]+\s+(.+)$/;
const BARE_NUM = /^([0-9０-９]{1,3})\s+(.+)$/;

const isUncertain = (c) => typeof c === 'number' && !(Number.isFinite(c) && c >= UNCERTAIN_BELOW);
const isSectionKey = (key) => SECTION_WORDS.has(key) || SECTION_WORDS.has(key.replace(/[0-9]+$/, ''));

// 番号付きのセトリ（番号のついた曲が3行以上）：番号のない行（ライブ名・日付・サインなど）は曲にしない。
// 番号付きでなければ null。
function numberedSetlist(lines) {
  const songs = [];
  const sections = [];
  let numbered = 0; // 番号付きの曲の行数
  let main = 0; // 通常の番号（1, 2, 3…）の曲の数
  let lastEncore = false;
  for (const line of lines) {
    const raw = String(line?.text ?? '').trim();
    if (!raw) continue;
    const uncertain = isUncertain(line.confidence);
    const enc = raw.match(ENCORE_SONG);
    if (enc && enc[2].trim()) {
      const label = enc[1].replace(/\s+/g, '');
      const last = sections[sections.length - 1];
      if (!lastEncore && !(last && last.before_index === songs.length)) {
        sections.push({ before_index: songs.length, label });
      }
      songs.push({ title: enc[2].trim(), uncertain });
      numbered++;
      lastEncore = true;
      continue;
    }
    let rest = null;
    for (const re of MARKED_PREFIX) {
      if (re.test(raw)) { rest = raw.replace(re, '').trim(); break; }
    }
    let marked = rest !== null;
    if (!marked) {
      const m = raw.match(M_SPACE) || (() => {
        const b = raw.match(BARE_NUM);
        return b && Number(b[1].normalize('NFKC')) === main + 1 ? b : null;
      })();
      if (m) { rest = m[m.length - 1].trim(); marked = true; }
    }
    const text = marked ? rest : raw;
    const key = normalizeName(text);
    if (!key) continue;
    if (isSectionKey(key)) {
      sections.push({ before_index: songs.length, label: text });
      continue;
    }
    if (!marked) continue; // 番号のない行は捨てる
    songs.push({ title: text, uncertain });
    numbered++;
    main++;
    lastEncore = false;
  }
  return numbered >= 3 ? { songs, sections } : null;
}

// 貼り付けた文字を行に分ける（空行も残す）。
export function linesFromText(text) {
  return String(text ?? '').split(/\r\n|\n|\r/).map((t) => ({ text: t }));
}

// 読めた行を曲と区切りに整える。区切りの before_index は、次の曲の songs の位置。
export function toSetlist(lines) {
  const numbered = numberedSetlist(lines);
  if (numbered) return numbered;
  const songs = [];
  const sections = [];
  for (const line of lines) {
    const raw = String(line?.text ?? '').trim();
    if (!raw) continue;
    const text = stripNumber(raw, songs.length + 1);
    const key = normalizeName(text);
    if (!key) continue; // 記号だけの行・番号だけの行
    // EN1・MC② のように末尾に番号が付いた区切りも区切り。
    if (isSectionKey(key)) {
      sections.push({ before_index: songs.length, label: text });
      continue;
    }
    const c = line.confidence;
    songs.push({ title: text, uncertain: isUncertain(c) });
  }
  return { songs, sections };
}

export function toSetlistTracks(songs, artistName) {
  return songs.map((s) => ({
    title: s.title, artistName, source: 'setlist', isLatest: false, uncertain: !!s.uncertain,
  }));
}
