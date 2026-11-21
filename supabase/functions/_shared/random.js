// 推測できない乱数の文字列（base64url）。
export function randomB64url(bytes) {
  return bytesToB64url(globalThis.crypto.getRandomValues(new Uint8Array(bytes)));
}

export function bytesToB64url(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
