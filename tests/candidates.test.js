import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCandidates } from '../supabase/functions/_shared/candidates.js';

const s = (title, releaseDate) => ({ title, releaseDate });

test('buildCandidates: 除外曲を除く（Instrumental・Live は除き、feat. は残す）', () => {
  const { popular, recent } = buildCandidates([
    s('89', '2026-09-30T12:00:00Z'),
    s('89 (Instrumental)', '2026-09-30T12:00:00Z'),
    s('A (Live)', '2026-01-01T12:00:00Z'),
    s('めをみて feat.X from Y', '2026-02-01T12:00:00Z'),
  ], ['89']);
  assert.deepEqual(recent.map((c) => c.title), ['89', 'めをみて feat.X from Y']);
  assert.deepEqual(popular, [{ title: '89', source: 'lastfm' }]);
  assert.ok(recent.every((c) => c.source === 'itunes'));
});

test('buildCandidates: titleKey で重複を除き recent は新しい方を残す', () => {
  const { recent } = buildCandidates([
    s('曲A (Remastered 2020)', '2020-05-01T12:00:00Z'),
    s('曲A', '2015-05-01T12:00:00Z'),
    s('曲B', '2018-01-01T12:00:00Z'),
  ], []);
  assert.deepEqual(recent, [
    { title: '曲A (Remastered 2020)', source: 'itunes' },
    { title: '曲B', source: 'itunes' },
  ]);
});

test('buildCandidates: 順不同の入力でも recent は新しい順（同日は元の順）', () => {
  const { recent } = buildCandidates([
    s('古', '2010-01-01T12:00:00Z'),
    s('新1', '2026-09-30T12:00:00Z'),
    s('中', '2020-01-01T12:00:00Z'),
    s('新2', '2026-09-30T12:00:00Z'),
  ], []);
  assert.deepEqual(recent.map((c) => c.title), ['新1', '新2', '中', '古']);
});

test('buildCandidates: ローマ字の Last.fm 題名は popular から落ちる', () => {
  const { popular } = buildCandidates([s('夜想', '2024-01-01T12:00:00Z'), s('朝', '2023-01-01T12:00:00Z')], ['Yasou', '朝']);
  assert.deepEqual(popular, [{ title: '朝', source: 'lastfm' }]);
});

test('buildCandidates: popular は Last.fm の順、曲名は iTunes のもの、各曲1回', () => {
  const { popular } = buildCandidates([
    s('ＡＢＣ', '2020-01-01T12:00:00Z'),
    s('Two (Remastered 2020)', '2021-01-01T12:00:00Z'),
    s('Three', '2022-01-01T12:00:00Z'),
  ], ['three', 'Two', 'abc', 'THREE', 'Two - Remaster']);
  assert.deepEqual(popular.map((c) => c.title), ['Three', 'Two (Remastered 2020)', 'ＡＢＣ']);
  assert.ok(popular.every((c) => c.source === 'lastfm'));
});

test('buildCandidates: 除外曲は Last.fm に一致しても popular に入らない', () => {
  const { popular } = buildCandidates([s('X (Live)', '2020-01-01T12:00:00Z')], ['X (Live)']);
  assert.deepEqual(popular, []);
});
