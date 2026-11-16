import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readAuthReturn, pickReturnTo } from '../src/core/auth-url.js';

test('拒否された戻り：denied が true で、クエリとハッシュの error が消える', () => {
  const r = readAuthReturn(
    'https://x/app/?error=access_denied&error_code=&error_description=denied#error=access_denied&error_description=denied',
  );
  assert.equal(r.denied, true);
  assert.equal(r.code, null);
  assert.equal(r.cleanUrl, 'https://x/app/');
});

test('成功の戻り：code を取り出し、URL から消す', () => {
  const r = readAuthReturn('https://x/app/?code=abc123');
  assert.deepEqual(r, { code: 'abc123', denied: false, cleanUrl: 'https://x/app/' });
});

test('ふつうの #/ ルートは残し、ほかのクエリも残す', () => {
  const r = readAuthReturn('https://x/app/?code=c&keep=1#/live/abc?confirm=1');
  assert.equal(r.code, 'c');
  assert.equal(r.cleanUrl, 'https://x/app/?keep=1#/live/abc?confirm=1');
});

test('ハッシュ側の error だけを消し、ルートのハッシュは残す', () => {
  const r = readAuthReturn('https://x/?error=access_denied#/lives');
  assert.equal(r.denied, true);
  assert.equal(r.cleanUrl, 'https://x/#/lives');
});

test('ハッシュ側だけの error でも denied（ほかのハッシュ項目は残す）', () => {
  const r = readAuthReturn('https://x/#error=access_denied&error_code=x&foo=1');
  assert.equal(r.denied, true);
  assert.equal(r.cleanUrl, 'https://x/#foo=1');
});

test('access_denied 以外の error は denied にしない', () => {
  const r = readAuthReturn('https://x/?error=server_error');
  assert.equal(r.denied, false);
  assert.equal(r.cleanUrl, 'https://x/');
});

test('何もないときはそのまま', () => {
  const r = readAuthReturn('https://x/app/#/lives');
  assert.deepEqual(r, { code: null, denied: false, cleanUrl: 'https://x/app/#/lives' });
});

test('pickReturnTo：#/login は #/lives', () => {
  assert.equal(pickReturnTo('#/login'), '#/lives');
  assert.equal(pickReturnTo('#/login?x=1'), '#/lives');
});

test('pickReturnTo：#/ のルートはそのまま', () => {
  assert.equal(pickReturnTo('#/live/abc'), '#/live/abc');
});

test('pickReturnTo：外部・空・null は #/lives', () => {
  assert.equal(pickReturnTo('https://evil'), '#/lives');
  assert.equal(pickReturnTo('//evil'), '#/lives');
  assert.equal(pickReturnTo(''), '#/lives');
  assert.equal(pickReturnTo(null), '#/lives');
  assert.equal(pickReturnTo('#evil'), '#/lives');
});
