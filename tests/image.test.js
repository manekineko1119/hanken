import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitSize, totalBase64Length, fitsTotal } from '../src/core/image.js';

test('fitSize: 長い辺を max に縮める', () => {
  assert.deepEqual(fitSize(3000, 1500), { w: 1600, h: 800 });
  assert.deepEqual(fitSize(1500, 3000), { w: 800, h: 1600 });
});

test('fitSize: 小さければそのまま、端数は四捨五入', () => {
  assert.deepEqual(fitSize(800, 600), { w: 800, h: 600 });
  assert.deepEqual(fitSize(1600, 1600), { w: 1600, h: 1600 });
  assert.deepEqual(fitSize(2000, 1001), { w: 1600, h: 801 });
});

test('totalBase64Length・fitsTotal: 文字数の合計が 4MB 以下ならよい', () => {
  assert.equal(totalBase64Length([]), 0);
  assert.equal(totalBase64Length(['abc', 'de']), 5);
  assert.equal(fitsTotal(['a'.repeat(4 * 1024 * 1024)]), true);
  assert.equal(fitsTotal(['a'.repeat(4 * 1024 * 1024), 'b']), false);
  assert.equal(fitsTotal(['aaa', 'bb'], 5), true);
  assert.equal(fitsTotal(['aaa', 'bb'], 4), false);
});

test('jpegQualitySteps: 高い順の4段階', async () => {
  const { jpegQualitySteps } = await import('../src/core/image.js');
  assert.deepEqual(jpegQualitySteps(), [0.85, 0.75, 0.65, 0.55]);
});
