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

// 行頭の番号の数（①・M4・4. など）。読めなければ null。
function numOf(raw) {
  const c = raw.charCodeAt(0);
  if (c >= 0x2460 && c <= 0x2473) return c - 0x245f;
  if (c >= 0x3251 && c <= 0x325f) return c - 0x3251 + 21;
  if (c >= 0x32b1 && c <= 0x32bf) return c - 0x32b1 + 36;
  const m = raw.match(/[0-9０-９]+/);
  return m ? Number(m[0].normalize('NFKC')) : null;
}
const PREFIX_ONLY = /^[MＭmｍ]\s*[-－ー]?\s*[0-9０-９]+$/;

// 番号付きのセトリの1行を見分ける。st：{ last（さっきの番号）, fresh（区切りの直後）}。
function classify(raw, st) {
  // 次の番号としてありそうか：さっきより大きく3つ先まで。区切りの直後と最初は 1〜3 から。
  const plausible = (n) => n !== null
    && ((n > st.last && n <= st.last + 3) || ((st.fresh || st.last === 0) && n >= 1 && n <= 3));
  const sec = (text) => {
    const key = normalizeName(text);
    if (!key) return { kind: 'skip' };
    return isSectionKey(key) ? { kind: 'section', text } : null;
  };
  const enc = raw.match(ENCORE_SONG);
  if (enc && enc[2].trim()) {
    return { kind: 'encore', label: enc[1].replace(/\s+/g, ''), text: enc[2].trim(), n: numOf(enc[0].slice(enc[1].length)) };
  }
  for (const re of MARKED_PREFIX) {
    if (!re.test(raw)) continue;
    const rest = raw.replace(re, '').trim();
    const n = numOf(raw);
    if (!rest) return plausible(n) ? { kind: 'prefix', n } : { kind: 'other' };
    return sec(rest) || { kind: 'song', text: rest, n };
  }
  if (PREFIX_ONLY.test(raw)) {
    const n = numOf(raw.slice(1));
    return plausible(n) ? { kind: 'prefix', n } : { kind: 'other' };
  }
  const m = raw.match(M_SPACE) || raw.match(BARE_NUM);
  if (m) {
    const n = numOf(raw.replace(/^[MＭmｍ]\s*[-－ー]?\s*/, ''));
    if (plausible(n)) {
      const rest = m[m.length - 1].trim();
      return sec(rest) || { kind: 'song', text: rest, n };
    }
  }
  return sec(raw) || { kind: 'other' };
}

// 番号付きのセトリ（番号のついた曲が3行以上）：番号のない行（ライブ名・日付・サインなど）は曲にしない。
// 番号付きでなければ null。
function numberedSetlist(lines) {
  const rows = lines
    .map((l) => ({ raw: String(l?.text ?? '').trim(), unc: isUncertain(l?.confidence) }))
    .filter((r) => r.raw);
  const songs = [];
  const sections = [];
  const st = { last: 0, fresh: false };
  let main = 0; // 通常の番号の曲の数
  let numbered = 0; // アンコールの番号の曲も入れた数
  let encoreLabel = null;
  for (let i = 0; i < rows.length; i++) {
    const { raw, unc } = rows[i];
    const c = classify(raw, st);
    if (c.kind === 'section') {
      sections.push({ before_index: songs.length, label: c.text });
      st.fresh = true;
    } else if (c.kind === 'encore') {
      const last = sections[sections.length - 1];
      const label = c.label.toUpperCase();
      if (label !== encoreLabel && !(last && last.before_index === songs.length)) {
        sections.push({ before_index: songs.length, label: c.label });
      }
      encoreLabel = label;
      songs.push({ title: c.text, uncertain: unc });
      numbered++;
      st.last = 0; // アンコールのあとは、番号が 1 から振り直されてもよい
      st.fresh = true;
    } else if (c.kind === 'song') {
      songs.push({ title: c.text, uncertain: unc });
      main++; numbered++;
      encoreLabel = null;
      st.last = c.n ?? st.last + 1; st.fresh = false;
    } else if (c.kind === 'prefix') {
      // 番号と曲名が2行に割れたとき：次の行が番号のない行なら、それを曲名にする。
      const next = rows[i + 1];
      if (next && classify(next.raw, st).kind === 'other') {
        songs.push({ title: next.raw, uncertain: unc || next.unc });
        main++; numbered++;
        encoreLabel = null;
        st.last = c.n ?? st.last + 1; st.fresh = false;
        i++;
      }
    }
  }
  return main >= 2 && numbered >= 3 ? { songs, sections } : null;
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
