// YouTube の search.list は、タイトルの & ' " < > を HTML の文字参照で返す。照合・保存の前に元に戻す。
const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

export function decodeEntities(s) {
  return String(s ?? '').replace(/&(?:#(\d+)|#[xX]([0-9a-fA-F]+)|([a-zA-Z]+));/g, (whole, dec, hex, name) => {
    if (name) return Object.hasOwn(NAMED, name) ? NAMED[name] : whole;
    const cp = dec !== undefined ? Number(dec) : parseInt(hex, 16);
    return Number.isInteger(cp) && cp > 0 && cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff) ? String.fromCodePoint(cp) : whole;
  });
}
