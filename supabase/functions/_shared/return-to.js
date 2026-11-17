// 戻り先は、アプリ内のハッシュのパス（#/…）だけを許す。
export function safeReturnTo(s) {
  if (typeof s !== 'string') return null;
  if (s.length > 500) return null;
  if (!s.startsWith('#/')) return null;
  if (s.startsWith('#//')) return null;
  if (/[:\@\r\n\0]/.test(s)) return null;
  if (/[\u0000-\u001f\u007f]/.test(s)) return null;
  return s;
}
