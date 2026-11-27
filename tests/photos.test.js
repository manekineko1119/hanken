import { test } from 'node:test';
import assert from 'node:assert/strict';
import { photoPath, canAddPhoto, MAX_PHOTOS, MAX_PHOTO_BYTES, PHOTO_URL_SECONDS, PHOTO_MSG } from '../src/core/photos.js';
import { listPhotos, addPhoto, deletePhoto, makePhotoBlob } from '../src/data/photos.js';
import { deleteLive, updateLiveFields } from '../src/data/lives.js';

test('定数と photoPath・canAddPhoto', () => {
  assert.equal(MAX_PHOTOS, 5);
  assert.equal(MAX_PHOTO_BYTES, 1048576);
  assert.equal(PHOTO_URL_SECONDS, 3600);
  assert.equal(photoPath('u1', 'l1', 'p1'), 'u1/l1/p1.jpg');
  assert.equal(canAddPhoto(4), true);
  assert.equal(canAddPhoto(5), false);
});

// 呼び出しの順番を log に残す、小さな偽クライアント。
function fakeClient({ rows = [], insertError = null, uploadError = null, removeError = null, badPaths = [], log = [] } = {}) {
  const client = {
    log,
    from(table) {
      const q = { table };
      return {
        select: () => ({
          eq: (c, v) => {
            const r = { data: rows, error: null, order() { return this; } };
            r.order = () => ({ ...r, order: () => r });
            log.push(`select ${table} ${c}=${v}`);
            return r;
          },
        }),
        insert: async (row) => { log.push(`insert ${table} ${row.storage_path}`); return { error: insertError }; },
        delete: () => ({ eq: async (c, v) => { log.push(`delete ${q.table} ${c}=${v}`); return { error: null }; } }),
      };
    },
    storage: {
      from: () => ({
        createSignedUrl: async (p, sec) => (badPaths.includes(p) ? { data: null, error: new Error('x') } : { data: { signedUrl: `https://s/${p}?t=${sec}` }, error: null }),
        upload: async (p, blob, opt) => { client.uploaded = blob; log.push(`upload ${p} ${opt.contentType} upsert=${opt.upsert}`); return { error: uploadError }; },
        remove: async (paths) => { log.push(`remove ${paths.join(',')}`); return { error: removeError }; },
      }),
    },
  };
  return client;
}

test('listPhotos: URL が作れない行は url: null で残す（5枚の数に入るため）', async () => {
  const rows = [{ id: 'a', storage_path: 'u/l/a.jpg' }, { id: 'b', storage_path: 'u/l/b.jpg' }];
  const client = fakeClient({ rows, badPaths: ['u/l/b.jpg'] });
  const r = await listPhotos('l', { client });
  assert.deepEqual(r, [
    { id: 'a', url: 'https://s/u/l/a.jpg?t=3600', storage_path: 'u/l/a.jpg' },
    { id: 'b', url: null, storage_path: 'u/l/b.jpg' },
  ]);
});

const shrunk = { size: 100, shrunk: true };
const okShrink = async () => shrunk;
const deps = (client, extra = {}) => ({ client, userId: 'u', newId: () => 'p1', shrink: okShrink, ...extra });

test('addPhoto: 行を入れてからファイルを置く', async () => {
  const client = fakeClient();
  const r = await addPhoto('l', {}, deps(client));
  assert.equal(r.id, 'p1');
  assert.deepEqual(client.log, ['insert live_photos u/l/p1.jpg', 'upload u/l/p1.jpg image/jpeg upsert=false']);
  assert.equal(client.uploaded, shrunk); // 元の File ではなく、縮めた Blob を置く
});

test('addPhoto: upload が失敗したら行を消してエラー', async () => {
  const client = fakeClient({ uploadError: new Error('boom') });
  await assert.rejects(addPhoto('l', {}, deps(client)), { message: PHOTO_MSG.failed });
  assert.equal(client.log.at(-1), 'delete live_photos id=p1');
});

test('addPhoto: PHOTO_LIMIT は5枚までのエラー、ほかは保存失敗', async () => {
  const c1 = fakeClient({ insertError: { message: 'PHOTO_LIMIT' } });
  await assert.rejects(addPhoto('l', {}, deps(c1)), { message: PHOTO_MSG.limit });
  assert.ok(!c1.log.some((s) => s.startsWith('upload')));
  const c2 = fakeClient({ insertError: { message: 'other' } });
  await assert.rejects(addPhoto('l', {}, deps(c2)), { message: PHOTO_MSG.failed });
});

test('makePhotoBlob: 品質を下げて作り直し、最後でも超えたら断る', async () => {
  const qs = [];
  const shrink = async (f, q) => { qs.push(q); return { size: q > 0.7 ? 2000 : 500 }; };
  const b = await makePhotoBlob({}, shrink, 1000);
  assert.deepEqual(qs, [0.85, 0.75, 0.65]);
  assert.equal(b.size, 500);
  await assert.rejects(makePhotoBlob({}, async () => ({ size: 9999 }), 1000), { message: PHOTO_MSG.tooBig });
});

test('deletePhoto: ファイル → 行の順', async () => {
  const client = fakeClient();
  await deletePhoto({ id: 'p1', storage_path: 'u/l/p1.jpg' }, { client });
  assert.deepEqual(client.log, ['remove u/l/p1.jpg', 'delete live_photos id=p1']);
});

test('deleteLive: 先にファイルを消してからライブを消す。消せなければライブも消さない', async () => {
  const rows = [{ storage_path: 'u/l/a.jpg' }, { storage_path: 'u/l/b.jpg' }];
  const ok = fakeClient({ rows });
  await deleteLive('l', ok);
  assert.deepEqual(ok.log, ['select live_photos live_id=l', 'remove u/l/a.jpg,u/l/b.jpg', 'delete lives id=l']);
  const ng = fakeClient({ rows, removeError: new Error('x') });
  await assert.rejects(deleteLive('l', ng));
  assert.ok(!ng.log.some((s) => s.startsWith('delete lives')));
});

test('deleteLive: 写真が0枚なら remove は呼ばず、ライブは消す', async () => {
  const c = fakeClient({ rows: [] });
  await deleteLive('l', c);
  assert.deepEqual(c.log, ['select live_photos live_id=l', 'delete lives id=l']);
});

function fakeUpdateDb(result) {
  const calls = [];
  const q = { update: (p) => { calls.push(['update', p]); return q; }, eq: (k, v) => { calls.push(['eq', k, v]); return q; }, select: (c) => { calls.push(['select', c]); return Promise.resolve(result); } };
  return { calls, db: { from: (t) => { calls.push(['from', t]); return q; } } };
}

test('updateLiveFields: 1行返れば成功、0行（権限で止められた）・エラーは例外', async () => {
  const ok = fakeUpdateDb({ data: [{ id: 'l' }], error: null });
  await updateLiveFields('l', { impression: 'x' }, ok.db);
  assert.deepEqual(ok.calls[0], ['from', 'lives']);
  assert.deepEqual(ok.calls[1], ['update', { impression: 'x' }]);
  await assert.rejects(updateLiveFields('l', {}, fakeUpdateDb({ data: [], error: null }).db));
  await assert.rejects(updateLiveFields('l', {}, fakeUpdateDb({ data: null, error: new Error('x') }).db));
});
