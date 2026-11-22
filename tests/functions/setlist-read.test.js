import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handle } from '../../supabase/functions/setlist-read/handler.js';
import { VISION_URL, visionBody } from '../../supabase/functions/_shared/vision.js';
import { makeDeps, post } from './helpers.js';

const env = { VISION_API_KEY: 'test-key' };
const B64 = 'QUJDREVGRw=='; // ダミーの base64
const SECRET_LINE = 'ひみつの曲名XYZ';

// 1行ぶんの Vision の返事（読めた文字は SECRET_LINE）
const okVision = (n = 1) => ({
  responses: Array.from({ length: n }, () => ({
    fullTextAnnotation: {
      pages: [{ blocks: [{ paragraphs: [{ words: [{
        confidence: 0.9,
        symbols: [...SECRET_LINE].map((ch, i, a) => ({ text: ch, property: i === a.length - 1 ? { detectedBreak: { type: 'LINE_BREAK' } } : undefined })),
      }] }] }] }],
    },
  })),
});

const reserveCalls = (db) => db.rpcCalls.filter((c) => c.name === 'reserve_vision');
const visionUsage = (db) => db.tables.vision_usage?.[0]?.images ?? 0;

// console を差し替え、base64・読めた文字・キーが出ていないことを確かめる
async function withLogSpy(fn) {
  const logged = [];
  const orig = { log: console.log, error: console.error, warn: console.warn };
  const fmt = (x) => (x instanceof Error ? `${x.name} ${x.message}` : typeof x === 'string' ? x : JSON.stringify(x));
  for (const k of Object.keys(orig)) console[k] = (...a) => logged.push(a.map(fmt).join(' '));
  try {
    return await fn();
  } finally {
    Object.assign(console, orig);
    const all = logged.join('\n');
    for (const s of [B64, SECRET_LINE, env.VISION_API_KEY]) assert.ok(!all.includes(s), `ログに出ている: ${s.slice(0, 8)}`);
  }
}

const bad = [
  ['images なし', {}],
  ['空の配列', { images: [] }],
  ['5枚', { images: [B64, B64, B64, B64, B64] }],
  ['文字列でない要素', { images: [B64, 5] }],
  ['空文字の要素', { images: [B64, ''] }],
  ['配列でない', { images: B64 }],
  ['合わせて4MB超え', { images: ['A'.repeat(2 * 1024 * 1024), 'A'.repeat(2 * 1024 * 1024 + 1)] }],
];
for (const [name, body] of bad) {
  test(`入力の誤り（${name}）：400 BAD_INPUT で、reserve_vision も fetch も呼ばない`, async () => {
    const { deps, calls, db } = makeDeps({ env, fetchMap: () => ({ body: okVision() }) });
    const res = await withLogSpy(() => handle(post(body), deps));
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error.code, 'BAD_INPUT');
    assert.equal(calls.length, 0);
    assert.equal(reserveCalls(db).length, 0);
  });
}

test('ちょうど 4MB は通る', async () => {
  const { deps, calls } = makeDeps({ env, fetchMap: () => ({ body: okVision(2) }) });
  const res = await handle(post({ images: ['A'.repeat(2 * 1024 * 1024), 'A'.repeat(2 * 1024 * 1024)] }), deps);
  assert.equal(res.status, 200);
  assert.equal(calls.length, 1);
});

test('ログインなし：401 で、何も呼ばない', async () => {
  const { deps, calls, db } = makeDeps({ env });
  const res = await handle(post({ images: [B64] }, { jwt: null }), deps);
  assert.equal(res.status, 401);
  assert.equal(calls.length, 0);
  assert.equal(reserveCalls(db).length, 0);
});

for (const scope of ['month', 'day']) {
  test(`reserve_vision が '${scope}'：200 LIMIT で、fetch は0回`, async () => {
    const tables = scope === 'month'
      ? { vision_usage: [{ month_pt: '2026-11-01', images: 799 }] }
      : { user_daily_usage: [{ user_id: 'u1', day_jst: '2026-11-17', kind: 'setlist', count: 10 }] };
    const { deps, calls, db } = makeDeps({ env, tables, fetchMap: () => ({ body: okVision(2) }) });
    const res = await handle(post({ images: [B64, B64] }), deps);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { error: 'LIMIT', scope });
    assert.equal(calls.length, 0);
    assert.equal(reserveCalls(db).length, 1);
  });
}

test('成功：Vision を1回呼び、数えてから行を返す', async () => {
  const { deps, calls, reqs, db } = makeDeps({ env, fetchMap: () => ({ body: okVision(2) }) });
  const res = await withLogSpy(() => handle(post({ images: [B64, B64] }), deps));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), {
    lines: [{ text: SECRET_LINE, confidence: 0.9, image: 0 }, { text: SECRET_LINE, confidence: 0.9, image: 1 }],
  });
  assert.equal(calls.length, 1);
  assert.equal(reqs[0].url, VISION_URL);
  assert.ok(!reqs[0].url.includes('test-key'));
  assert.equal(reqs[0].headers['X-Goog-Api-Key'], 'test-key');
  assert.equal(reqs[0].method, 'POST');
  assert.deepEqual(reqs[0].body, visionBody([B64, B64]));
  const r = reserveCalls(db);
  assert.equal(r.length, 1);
  assert.equal(r[0].p_user_id, 'u1');
  assert.equal(r[0].p_images, 2);
  assert.equal(r[0].p_day_jst, '2026-11-17'); // NOW = 2026-11-17T00:00Z → 日本時間 9 時
  assert.equal(r[0].p_month_pt, '2026-11-01'); // 太平洋時間は 11-16 → 月の初日
  assert.equal(visionUsage(db), 2);
  assert.equal(db.tables.user_daily_usage.find((x) => x.kind === 'setlist').count, 1);
});

test('月の初日：太平洋時間の月で決める（UTC では翌月でも太平洋ではまだ前の月）', async () => {
  const { deps, db } = makeDeps({ env, fetchMap: () => ({ body: okVision() }) });
  deps.now = () => new Date('2026-12-01T03:00:00Z'); // PT は 11-30、JST は 12-01
  await handle(post({ images: [B64] }), deps);
  const r = reserveCalls(db)[0];
  assert.equal(r.p_month_pt, '2026-11-01');
  assert.equal(r.p_day_jst, '2026-12-01');
});

test('何も読めなかったときは lines: []', async () => {
  const { deps } = makeDeps({ env, fetchMap: () => ({ body: { responses: [{}] } }) });
  const res = await handle(post({ images: [B64] }), deps);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { lines: [] });
});

test('Vision が 500：502 UPSTREAM。数えた枚数は戻さない', async () => {
  const { deps, calls, db } = makeDeps({ env, fetchMap: () => ({ status: 500, body: { error: { message: SECRET_LINE } } }) });
  const res = await withLogSpy(() => handle(post({ images: [B64, B64, B64] }), deps));
  assert.equal(res.status, 502);
  assert.equal((await res.json()).error.code, 'UPSTREAM');
  assert.equal(calls.length, 1);
  assert.equal(visionUsage(db), 3);
});

test('すべての画像が Vision のエラー：502 UPSTREAM（枚数はそのまま）', async () => {
  const { deps, db } = makeDeps({ env, fetchMap: () => ({ body: { responses: [{ error: { code: 3 } }] } }) });
  const res = await handle(post({ images: [B64] }), deps);
  assert.equal(res.status, 502);
  assert.equal(visionUsage(db), 1);
});

test('Vision の返事の形が違う（TypeError など）：502 UPSTREAM', async () => {
  const { deps } = makeDeps({ env, fetchMap: () => ({ body: { responses: [{ fullTextAnnotation: { pages: 5 } }] } }) });
  const res = await withLogSpy(() => handle(post({ images: [B64] }), deps));
  assert.equal(res.status, 502);
  assert.equal((await res.json()).error.code, 'UPSTREAM');
});

test('fetch が失敗・タイムアウト：502 UPSTREAM（枚数はそのまま）', async () => {
  const { deps, db } = makeDeps({ env, fetchMap: () => { throw new Error(`timeout ${B64}`); } });
  const res = await withLogSpy(() => handle(post({ images: [B64] }), deps));
  assert.equal(res.status, 502);
  assert.equal((await res.json()).error.code, 'UPSTREAM');
  assert.equal(visionUsage(db), 1);
});

test('fetch にはタイムアウトの signal を付ける', async () => {
  const { deps } = makeDeps({ env, fetchMap: () => ({ body: okVision() }) });
  const orig = deps.fetch;
  let signal;
  deps.fetch = (u, init) => { signal = init.signal; return orig(u, init); };
  await handle(post({ images: [B64] }), deps);
  assert.ok(signal instanceof AbortSignal);
});

test('VISION_API_KEY がない：502 UPSTREAM で、reserve_vision も fetch も呼ばない', async () => {
  const { deps, calls, db } = makeDeps({ env: {}, fetchMap: () => ({ body: okVision() }) });
  const res = await handle(post({ images: [B64] }), deps);
  assert.equal(res.status, 502);
  assert.equal((await res.json()).error.code, 'UPSTREAM');
  assert.equal(calls.length, 0);
  assert.equal(reserveCalls(db).length, 0);
});

test('reserve_vision がエラー：502 UPSTREAM で、fetch は呼ばない', async () => {
  const { deps, calls } = makeDeps({ env, errors: { rpc: { code: 'X', message: 'boom' } }, fetchMap: () => ({ body: okVision() }) });
  const res = await withLogSpy(() => handle(post({ images: [B64] }), deps));
  assert.equal(res.status, 502);
  assert.equal(calls.length, 0);
});

test('キーはエラーの本文に出ない', async () => {
  const { deps } = makeDeps({ env, fetchMap: () => ({ status: 500, body: {} }) });
  const res = await handle(post({ images: [B64] }), deps);
  assert.ok(!(await res.text()).includes('test-key'));
});

test('Content-Length が大きすぎる：読む前に 400 BAD_INPUT（何も呼ばない）', async () => {
  const { deps, calls, db } = makeDeps({ env, fetchMap: () => ({ body: okVision() }) });
  const req = post({ images: [B64] });
  req.headers.set('Content-Length', String(4 * 1024 * 1024 + 64 * 1024 + 1));
  const res = await handle(req, deps);
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error.code, 'BAD_INPUT');
  assert.equal(calls.length, 0);
  assert.equal(reserveCalls(db).length, 0);
});
