import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeName, titleKey, isExcludedTitle } from '../src/core/normalize.js';

test('normalizeName: 全角半角・大小文字・空白・記号をそろえる', () => {
  assert.equal(normalizeName('ＡＢＣ　Ｄ'), 'abcd');
  assert.equal(normalizeName('Band・A、B。「C」'), 'bandabc');
  assert.equal(normalizeName('  The  Band! '), 'theband');
});

test('titleKey: 付け足しを除く', () => {
  assert.equal(titleKey('曲名 (Remastered 2020)'), titleKey('曲名'));
  assert.equal(titleKey('曲名 - Remaster'), titleKey('曲名'));
  assert.equal(titleKey('曲名 (Live)'), titleKey('曲名'));
  assert.equal(titleKey('曲名 [Live]'), titleKey('曲名'));
  assert.equal(titleKey('曲名 (Instrumental)'), titleKey('曲名'));
  assert.equal(titleKey('曲名 (off vocal)'), titleKey('曲名'));
  assert.equal(titleKey('曲名 -off vocal-'), titleKey('曲名'));
  assert.equal(titleKey('曲名 (TV size)'), titleKey('曲名'));
  assert.equal(titleKey('曲名 (Acoustic ver.)'), titleKey('曲名'));
  assert.equal(titleKey('曲名 - Single Ver.'), titleKey('曲名'));
  assert.equal(titleKey('ＡＢＣ'), titleKey('abc'));
});

test('titleKey: feat. は残す', () => {
  assert.notEqual(titleKey('めをみて feat.X from Y'), titleKey('めをみて'));
});

test('isExcludedTitle: 除く曲', () => {
  for (const t of ['A (Live)', 'A [Live]', 'A - Live', '89 (Instrumental)', 'A (inst.)', 'A (Off Vocal)',
    'A -off vocal-', 'A (カラオケ)', 'A (Karaoke)', 'A (TV size)', 'Ａ（ＴＶ　ＳＩＺＥ）', 'A (LIVE)']) {
    assert.equal(isExcludedTitle(t), true, t);
  }
});

test('isExcludedTitle: 残す曲', () => {
  for (const t of ['89', 'めをみて feat.X from Y', 'Alive', 'Deliver', 'Remastered Love']) {
    assert.equal(isExcludedTitle(t), false, t);
  }
});
