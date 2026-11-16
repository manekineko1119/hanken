import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handle } from '../../supabase/functions/track-candidates/handler.js';
import { makeDeps, post, daysAgo, NOW } from './helpers.js';

const song = (trackName, releaseDate) => ({ wrapperType: 'track', trackName, releaseDate });
const ITUNES = {
  results: [
    { wrapperType: 'artist', artistName: 'Aizora to Tsuki' },
    song('古い曲', '2020-01-01T00:00:00Z'),
    song('新しい曲', '2026-05-01T00:00:00Z'),
    song('中間の曲', '2023-01-01T00:00:00Z'),
    song('中間の曲 (Live)', '2024-01-01T00:00:00Z'),
    song('新しい曲 - Remaster', '2025-01-01T00:00:00Z'),
    song('Song (Instrumental)', '2024-06-01T00:00:00Z'),
  ],
};
const lastfm = (...names) => ({ toptracks: { track: names.map((name) => ({ name })) } });
const body = { artistName: '藍空と月', itunesArtistId: 42 };
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

test('lookup の artist 名が同じ（そろえて）なら Last.fm は1回だけ引く', async () => {
  const same = { results: [{ wrapperType: 'artist', artistName: ' 藍空と月 ' }, ...ITUNES.results.slice(1)] };
  const { deps, calls } = makeDeps({ env, fetchMap: router({ jp: lastfm('古い曲'), itunes: same }) });
  await handle(post(body), deps);
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
  const payload = { popular: [{ title: 'p', source: 'lastfm' }], recent: [{ title: 'cached', source: 'itunes' }], lastfmFound: true };
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
  assert.equal(db.upserts[0].row.fetched_at, NOW.toISOString());
  assert.equal(db.upserts[0].row.payload.recent.length, 3);
});

test('BAD_INPUT：id が正の整数でない・名前が長い・artistName が空', async () => {
  const { deps, calls } = makeDeps({ env });
  const cases = [
    { ...body, itunesArtistId: undefined }, { ...body, itunesArtistId: '42' }, { ...body, itunesArtistId: 0 },
    { ...body, itunesArtistId: 1.5 }, { ...body, itunesArtistId: 2 ** 60 }, { ...body, artistName: 'a'.repeat(101) },
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

test('Last.fm が 500・error・通信エラー・キーなしなら cache に保存しない（200 は返す）', async () => {
  const itunesOnly = (r) => (url) => (url.includes('itunes.apple.com') ? { body: ITUNES } : r());
  const variants = [
    { env, fetchMap: itunesOnly(() => ({ status: 500, body: {} })) },
    { env, fetchMap: itunesOnly(() => ({ body: { error: 6 } })) },
    { env, fetchMap: itunesOnly(() => { throw new Error('net'); }) },
    { env: {}, fetchMap: router() },
  ];
  for (const v of variants) {
    const { deps, db } = makeDeps(v);
    const res = await handle(post(body), deps);
    assert.equal(res.status, 200);
    assert.equal(db.upserts.length, 0);
  }
});

test('Last.fm が答えて一致が0なら保存する（lastfmFound false）', async () => {
  const { deps, db } = makeDeps({ env, fetchMap: router() });
  await handle(post(body), deps);
  assert.equal(db.upserts.length, 1);
  assert.equal(db.upserts[0].row.payload.lastfmFound, false);
});

test('lastfmFound=false のキャッシュは2日前なら取り直す、半日前なら使う', async () => {
  const payload = { popular: [], recent: [{ title: 'c', source: 'itunes' }], lastfmFound: false };
  const old = makeDeps({ env, fetchMap: router(), tables: { track_cache: [{ artist_key: 'itunes:42', payload, fetched_at: daysAgo(2) }] } });
  await handle(post(body), old.deps);
  assert.ok(old.calls.length > 0);
  const fresh = makeDeps({ env, tables: { track_cache: [{ artist_key: 'itunes:42', payload, fetched_at: daysAgo(0.5) }] } });
  const res = await handle(post(body), fresh.deps);
  assert.deepEqual(await res.json(), payload);
  assert.equal(fresh.calls.length, 0);
});

test('クライアントが送る itunesArtistName は無視し、lookup の artist 名で Last.fm を引く', async () => {
  const { deps, calls } = makeDeps({ env, fetchMap: router() });
  await handle(post({ ...body, itunesArtistName: 'Evil Name' }), deps);
  assert.ok(!calls.some((u) => u.includes('Evil')));
  assert.ok(calls.some((u) => u.includes('Aizora')));
});

test('返す本文に Last.fm のキーが入らない', async () => {
  for (const fetchMap of [router(), () => ({ status: 500, body: {} })]) {
    const { deps } = makeDeps({ env, fetchMap });
    const res = await handle(post(body), deps);
    assert.ok(!(await res.text()).includes('test-key'));
  }
});

test('キャッシュに当たる場合も JWT なしは 401', async () => {
  const payload = { popular: [{ title: 'p', source: 'lastfm' }], recent: [], lastfmFound: true };
  const { deps, calls } = makeDeps({ env, tables: { track_cache: [{ artist_key: 'itunes:42', payload, fetched_at: daysAgo(1) }] } });
  assert.equal((await handle(post(body, { jwt: null }), deps)).status, 401);
  assert.equal(calls.length, 0);
});

test('許可リストの DB エラーは 502、エラー応答にも ACAO が付く', async () => {
  const { deps } = makeDeps({ env, errors: { allowed_emails: { code: 'XX000' } } });
  const res = await handle(post(body), deps);
  assert.equal(res.status, 502);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), 'http://localhost:8080');
  const bad = await handle(post({ ...body, itunesArtistId: 0 }), makeDeps({ env }).deps);
  assert.equal(bad.headers.get('Access-Control-Allow-Origin'), 'http://localhost:8080');
});

test('track_cache の読み書きエラーでも 200 を返す', async () => {
  const { deps } = makeDeps({ env, fetchMap: router(), errors: { track_cache: { code: 'XX000' } } });
  assert.equal((await handle(post(body), deps)).status, 200);
});
