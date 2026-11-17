// 戻り先は、アプリ内のハッシュのパス（#/…）だけを許す。印字できる ASCII のみ。
export function safeReturnTo(s) {
  if (typeof s !== 'string') return null;
  if (s.length > 500) return null;
  if (!/^#\/[\x21-\x7e]*$/.test(s)) return null;
  if (/[\\@:]/.test(s) || s.includes('//')) return null;
  return s;
}
