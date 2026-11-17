// AES-256-GCM。出力は base64url( iv(12) || ciphertext+tag )。鍵の保管はここではしない。
const enc = new TextEncoder();
const dec = new TextDecoder();

function b64ToBytes(s) {
  let t = String(s).trim().replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
  while (t.length % 4) t += '=';
  const bin = atob(t);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToB64url(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function importKey(keyB64, usage) {
  const raw = b64ToBytes(keyB64);
  if (raw.length !== 32) throw new Error('暗号化の鍵は32バイトである必要があります');
  return globalThis.crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, [usage]);
}

export async function encrypt(plain, keyB64) {
  const key = await importKey(keyB64, 'encrypt');
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await globalThis.crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plain)));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv, 0);
  out.set(ct, 12);
  return bytesToB64url(out);
}

export async function decrypt(token, keyB64) {
  const key = await importKey(keyB64, 'decrypt');
  const data = b64ToBytes(token);
  if (data.length < 12 + 16) throw new Error('暗号文が短すぎます');
  const pt = await globalThis.crypto.subtle.decrypt({ name: 'AES-GCM', iv: data.slice(0, 12) }, key, data.slice(12));
  return dec.decode(pt);
}
