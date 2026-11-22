import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitSize } from '../src/core/image.js';

test('fitSize: 長い辺を max に縮める', () => {
  assert.deepEqual(fitSize(3000, 1500), { w: 1600, h: 800 });
  assert.deepEqual(fitSize(1500, 3000), { w: 800, h: 1600 });
});

test('fitSize: 小さければそのまま、端数は四捨五入', () => {
  assert.deepEqual(fitSize(800, 600), { w: 800, h: 600 });
  assert.deepEqual(fitSize(1600, 1600), { w: 1600, h: 1600 });
  assert.deepEqual(fitSize(2000, 1001), { w: 1600, h: 801 });
});
