// ブラウザと Supabase Edge Functions（Deno）の両方で使う。Node/Deno 固有の API は使わない。

// 名前・曲名のそろえ方：NFKC、小文字、空白と記号を除く。
// 記号だけの曲名は空のキーになり、buildCandidates で落ちる（受け入れ済み）。
export function normalizeName(s) {
  return String(s ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]/gu, '');
}

// 付け足し（括弧・ハイフンのあと）とみなす言葉。
const ADDITION = /(^|[^a-z])(remaster(ed)?|live|instrumental|inst|off\s*vocal|karaoke|tv\s*size|ver|version|mix|edit)([^a-z]|$)|カラオケ|リマスター/;

// 末尾の「(…)」「[…]」「- …」「-…-」のうち、付け足しの言葉を含むものを繰り返し取り除く。
function stripAdditions(title) {
  let t = String(title ?? '').normalize('NFKC').trim();
  for (;;) {
    const before = t;
    const bracket = t.match(/^(.*?)\s*[(\[]([^()\[\]]*)[)\]]\s*$/);
    if (bracket && ADDITION.test(bracket[2].toLowerCase())) {
      t = bracket[1].trim();
    } else {
      const dash = t.match(/^(.*?)\s+[-–—]\s*([^-–—]+?)\s*[-–—]?\s*$/);
      if (dash && ADDITION.test(dash[2].toLowerCase())) t = dash[1].trim();
    }
    if (t === before) return t;
  }
}

// 曲名の照合用キー。
export function titleKey(title) {
  return normalizeName(stripAdditions(title));
}

// Live・Instrumental・off vocal・カラオケ・inst.・TV size の曲か。
export function isExcludedTitle(title) {
  const t = String(title ?? '').normalize('NFKC').toLowerCase();
  if (/カラオケ|karaoke/.test(t)) return true;
  if (/(^|[^a-z])(instrumental|inst|off\s*vocal|tv\s*size)([^a-z]|$)/.test(t)) return true;
  // 「Live」は曲名の一部のこともあるので、括弧・ハイフンのあとにあるときだけ。
  const inBrackets = [...t.matchAll(/[(\[]([^()\[\]]*)[)\]]/g)].map((m) => m[1]);
  return inBrackets.some((x) => /(^|[^a-z])live([^a-z]|$)/.test(x))
    || /\s[-–—]\s*live\b/.test(t);
}
