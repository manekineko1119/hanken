import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compact } from '../src/ui/dom.js';

test('compact：null・undefined・false を除く（0 と空文字は残す）', () => {
  assert.deepEqual(compact(['a', null, undefined, false, 0, '', 'b']), ['a', 0, '', 'b']);
});

test('compact：空の配列は空のまま', () => {
  assert.deepEqual(compact([]), []);
});
