import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encrypt, decrypt } from '../supabase/functions/_shared/crypto.js';

const b64 = (bytes) => Buffer.from(bytes).toString('base64');
const KEY = b64(new Uint8Array(32).map((_, i) => i + 1));
const KEY2 = b64(new Uint8Array(32).map((_, i) => 200 - i));

test('encrypt/decrypt: 元に戻る（日本語も）', async () => {
  const t = await encrypt('refresh-token-あいう', KEY);
  assert.equal(await decrypt(t, KEY), 'refresh-token-あいう');
  assert.match(t, /^[A-Za-z0-9_-]+$/);
});

test('encrypt: 同じ文でも毎回違う文字になる', async () => {
  assert.notEqual(await encrypt('x', KEY), await encrypt('x', KEY));
});

test('decrypt: 鍵が違うと失敗', async () => {
  const t = await encrypt('x', KEY);
  await assert.rejects(decrypt(t, KEY2));
});

test('decrypt: 改ざんすると失敗', async () => {
  const t = await encrypt('hello', KEY);
  const raw = Buffer.from(t, 'base64url');
  raw[raw.length - 1] ^= 1;
  await assert.rejects(decrypt(raw.toString('base64url'), KEY));
});

test('鍵が32バイトでないとエラー', async () => {
  await assert.rejects(encrypt('x', b64(new Uint8Array(16))), /32/);
  await assert.rejects(decrypt('abc', b64(new Uint8Array(31))), /32/);
});

test('url-safe base64 の鍵も使える', async () => {
  const urlKey = Buffer.from(new Uint8Array(32).fill(251)).toString('base64url');
  assert.equal(await decrypt(await encrypt('ok', urlKey), urlKey), 'ok');
});

test('decrypt: 途中で切れた暗号文・不正な文字は失敗', async () => {
  const t = await encrypt('hello world', KEY);
  await assert.rejects(decrypt(t.slice(0, 20), KEY));
  await assert.rejects(decrypt('!!!!' + t.slice(4), KEY));
});
