import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safeReturnTo } from '../supabase/functions/_shared/return-to.js';

test('safeReturnTo: アプリ内のハッシュのパスはそのまま', () => {
  assert.equal(safeReturnTo('#/playlist/p1?confirm=1'), '#/playlist/p1?confirm=1');
  assert.equal(safeReturnTo('#/'), '#/');
});

test('safeReturnTo: 外部・不正な形は null', () => {
  for (const bad of ['https://evil.example/#/x', '#//evil', '#/a\nb', '#/a\rb', '#/a' + String.fromCharCode(92) + 'b', '#/a' + String.fromCharCode(8) + 'b', '#/a@b', '#/a:b', '#/a//b', '#/a b', '#/a／b', '#/a b', '#/a	b', '/x', '', '#x', null, undefined, 5, '#/' + 'a'.repeat(500)]) {
    assert.equal(safeReturnTo(bad), null, String(bad));
  }
});

test('safeReturnTo: 500文字ちょうどは通る', () => {
  const s = '#/' + 'a'.repeat(498);
  assert.equal(safeReturnTo(s), s);
});
