import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VISION_URL, visionBody, linesFromVision } from '../supabase/functions/_shared/vision.js';

const sym = (text, brk) => ({ text, ...(brk ? { property: { detectedBreak: { type: brk } } } : {}) });
const word = (text, confidence, brk) => ({ symbols: [sym(text, brk)], confidence });
const resp = (words) => ({ fullTextAnnotation: { pages: [{ blocks: [{ paragraphs: [{ words }] }] }] } });
const sample = () => resp([
  word('曲', 0.9),
  word('A', 0.7, 'LINE_BREAK'),
  word('曲', 0.95),
  word('B', 0.99, 'EOL_SURE_SPACE'),
]);

test('VISION_URL と visionBody', () => {
  assert.equal(VISION_URL, 'https://vision.googleapis.com/v1/images:annotate');
  const b = visionBody(['a', 'b']);
  assert.equal(b.requests.length, 2);
  for (const r of b.requests) {
    assert.deepEqual(r.features, [{ type: 'DOCUMENT_TEXT_DETECTION' }]);
    assert.deepEqual(r.imageContext, { languageHints: ['ja'] });
  }
  assert.equal(b.requests[1].image.content, 'b');
});

test('行に分け、confidence は最小値', () => {
  assert.deepEqual(linesFromVision({ responses: [sample()] }), [
    { text: '曲A', confidence: 0.7, image: 0 },
    { text: '曲B', confidence: 0.95, image: 0 },
  ]);
});

test('SPACE・SURE_SPACE のときだけ空白を入れる', () => {
  const r = resp([word('a', 0.9, 'SPACE'), word('b', 0.8, 'SURE_SPACE'), word('c', 0.7, 'LINE_BREAK')]);
  assert.deepEqual(linesFromVision({ responses: [r] }), [{ text: 'a b c', confidence: 0.7, image: 0 }]);
});

test('段落の終わりで行を閉じる', () => {
  const r = { fullTextAnnotation: { pages: [{ blocks: [{ paragraphs: [{ words: [word('x', 0.9)] }, { words: [word('y', 0.8)] }] }] }] } };
  assert.deepEqual(linesFromVision({ responses: [r] }).map((l) => l.text), ['x', 'y']);
});

test('複数画像は image 番号つきで順に', () => {
  const out = linesFromVision({ responses: [sample(), sample()] });
  assert.equal(out.length, 4);
  assert.equal(out[2].image, 1);
});

test('fullTextAnnotation なし・error の画像は行なし、ほかは返す', () => {
  const out = linesFromVision({ responses: [{ error: { code: 3, message: 'x' } }, sample(), {}] });
  assert.equal(out.length, 2);
  assert.equal(out[0].image, 1);
});

test('全部 error なら UPSTREAM', () => {
  assert.throws(
    () => linesFromVision({ responses: [{ error: { code: 3, message: 'x' } }, { error: { code: 3, message: 'y' } }] }),
    (e) => e instanceof Error && e.code === 'UPSTREAM',
  );
});
