import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handle } from '../../supabase/functions/track-candidates/handler.js';
import { makeDeps, post, daysAgo } from './helpers.js';

const song = (trackName, releaseDate) => ({ wrapperType: 'track', trackName, releaseDate });
const ITUNES = {
  results: [
    { wrapperType: 'artist', artistName: 'Band' },
    song('古い曲', '2020-01-01T00:00:00Z'),
    song('新しい曲', '2026-05-01T00:00:00Z'),
    song('中間の曲', '2023-01-01T00:00:00Z'),
    song('中間の曲 (Live)', '2024-01-01T00:00:00Z'),
    song('新しい曲 - Remaster', '2025-01-01T00:00:00Z'),
    song('Song (Instrumental)', '2024-06-01T00:00:00Z'),
  ],
};
const lastfm = (...names) => ({ toptracks: { track: names.map((name) => ({ name })) } });
const body = { artistName: '藍空と月', itunesArtistId: 42, itunesArtistName: 'Aizora to Tsuki' };
const env = { LASTFM_API_KEY: 'test-key' };

function router({ jp = lastfm(), roman = lastfm(), itunes = ITUNES } = {}) {
  return (url) => {
    if (url.includes('itunes.apple.com/lookup')) return { body: itunes };
    if (url.includes(encodeURIComponent('藍空と月'))) return { body: jp };
    if (url.includes('Aizora')) return { body: roman };
    throw new Error('unexpected ' + url);
  };
}

test('recent は発売日の新しい順（入力順に関係なく）、Live・Remaster 重複・Instrumental は除く', async () => {
  const { deps } = makeDeps({ env, fetchMap: router() });
  const res = await handle(post(body), deps);
  assert.equal(res.status, 200);
  const j = await res.json();
  assert.deepEqual(j.recent.map((c) => c.title), ['新しい曲', '中間の曲', '古い曲']);
});

test('Last.fm が空なら lastfmFound false・popular 空', async () => {
  const { deps } = makeDeps({ env, fetchMap: router() });
  const j = await (await handle(post(body), deps)).json();
  assert.equal(j.lastfmFound, false);
  assert.deepEqual(j.popular, []);
});

test('Last.fm の曲がローマ字だけで iTunes と一致しないなら popular 空', async () => {
  const { deps } = makeDeps({ env, fetchMap: router({ jp: lastfm('Atarashii Kyoku', 'Furui Kyoku'), roman: lastfm('Kimi no Uta') }) });
  const j = await (await handle(post(body), deps)).json();
  assert.deepEqual(j.popular, []);
  assert.equal(j.lastfmFound, false);
});

test('iTunes 名で引いた方が一致が多ければそちらを使う', async () => {
  const { deps } = makeDeps({ env, fetchMap: router({ jp: lastfm('古い曲'), roman: lastfm('中間の曲', '新しい曲', '古い曲') }) });
  const j = await (await handle(post(body), deps)).json();
  assert.deepEqual(j.popular.map((c) => c.title), ['中間の曲', '新しい曲', '古い曲']);
  assert.equal(j.lastfmFound, true);
});

test('一致数が同じなら artistName 側を使う', async () => {
  const { deps } = makeDeps({ env, fetchMap: router({ jp: lastfm('古い曲'), roman: lastfm('新しい曲') }) });
  const j = await (await handle(post(body), deps)).json();
  assert.deepEqual(j.popular.map((c) => c.title), ['古い曲']);
});

test('iTunes 名が同じ（そろえて）なら Last.fm は1回だけ引く', async () => {
  const { deps, calls } = makeDeps({ env, fetchMap: router({ jp: lastfm('古い曲') }) });
  await handle(post({ ...body, itunesArtistName: ' 藍空と月 ' }), deps);
  assert.equal(calls.filter((u) => u.includes('audioscrobbler')).length, 1);
});

test('LASTFM_API_KEY がなくても 200（popular 空）で Last.fm を呼ばない', async () => {
  const { deps, calls } = makeDeps({ env: {}, fetchMap: router() });
  const res = await handle(post(body), deps);
  assert.equal(res.status, 200);
  const j = await res.json();
  assert.deepEqual(j.popular, []);
  assert.equal(j.recent.length, 3);
  assert.equal(calls.filter((u) => u.includes('audioscrobbler')).length, 0);
});

test('Last.fm が error フィールド・500 でも 200', async () => {
  for (const r of [{ body: { error: 6, message: 'not found' } }, { status: 500, body: {} }]) {
    const { deps } = makeDeps({
      env,
      fetchMap: (url) => (url.includes('itunes.apple.com') ? { body: ITUNES } : r),
    });
    const res = await handle(post(body), deps);
    assert.equal(res.status, 200);
    assert.equal((await res.json()).lastfmFound, false);
  }
});

test('iTunes の lookup は sort=recent を使わず、Last.fm は autocorrect=1・limit=50', async () => {
  const { deps, calls } = makeDeps({ env, fetchMap: router() });
  await handle(post(body), deps);
  const lookup = calls.find((u) => u.includes('lookup'));
  assert.equal(lookup, 'https://itunes.apple.com/lookup?id=42&entity=song&country=JP&limit=200');
  const lf = calls.find((u) => u.includes('audioscrobbler'));
  assert.match(lf, /method=artist\.gettoptracks/);
  assert.match(lf, /autocorrect=1/);
  assert.match(lf, /limit=50/);
});

test('iTunes が失敗なら 502 UPSTREAM', async () => {
  const { deps } = makeDeps({ env, fetchMap: () => ({ status: 503, body: {} }) });
  const res = await handle(post(body), deps);
  assert.equal(res.status, 502);
  assert.equal((await res.json()).error.code, 'UPSTREAM');
});

test('キャッシュが29日前なら外部を呼ばず返す', async () => {
  const payload = { popular: [], recent: [{ title: 'cached', source: 'itunes' }], lastfmFound: false };
  const { deps, calls } = makeDeps({ env, tables: { track_cache: [{ artist_key: 'itunes:42', payload, fetched_at: daysAgo(29) }] } });
  const res = await handle(post(body), deps);
  assert.deepEqual(await res.json(), payload);
  assert.equal(calls.length, 0);
});

test('キャッシュが31日前なら取り直して upsert する', async () => {
  const payload = { popular: [], recent: [], lastfmFound: false };
  const { deps, calls, db } = makeDeps({ env, fetchMap: router(), tables: { track_cache: [{ artist_key: 'itunes:42', payload, fetched_at: daysAgo(31) }] } });
  const res = await handle(post(body), deps);
  assert.ok(calls.length > 0);
  assert.equal((await res.json()).recent.length, 3);
  assert.equal(db.upserts.length, 1);
  assert.equal(db.upserts[0].row.artist_key, 'itunes:42');
  assert.equal(db.upserts[0].row.payload.recent.length, 3);
});

test('キャッシュなしなら取得して保存する', async () => {
  const { deps, db } = makeDeps({ env, fetchMap: router() });
  await handle(post(body), deps);
  assert.equal(db.upserts[0].table, 'track_cache');
});

test('BAD_INPUT：id が正の整数でない・名前が長い・artistName が空', async () => {
  const { deps, calls } = makeDeps({ env });
  const cases = [
    { ...body, itunesArtistId: undefined }, { ...body, itunesArtistId: '42' }, { ...body, itunesArtistId: 0 },
    { ...body, itunesArtistId: 1.5 }, { ...body, artistName: 'a'.repeat(101) }, { ...body, itunesArtistName: 'a'.repeat(101) },
    { ...body, artistName: '  ' },
  ];
  for (const c of cases) {
    const res = await handle(post(c), deps);
    assert.equal(res.status, 400, JSON.stringify(c));
    assert.equal((await res.json()).error.code, 'BAD_INPUT');
  }
  assert.equal(calls.length, 0);
});

test('JWT なしは 401、許可リスト外は 403', async () => {
  const a = makeDeps({ env });
  assert.equal((await handle(post(body, { jwt: null }), a.deps)).status, 401);
  const b = makeDeps({ env, allowed: false });
  assert.equal((await handle(post(body), b.deps)).status, 403);
});
