// ライブの写真（Supabase の live_photos と Storage の live-photos）。薄く保つ。
// 順番が大事：行を入れる → ファイルを置く（Storage の権限が「自分の行がある」ことを見る）。失敗したら行を消す。
import { getClient } from '../auth/auth.js';
import { fitSize, jpegQualitySteps } from '../core/image.js';
import { MAX_PHOTO_BYTES, PHOTO_URL_SECONDS, PHOTO_MSG, photoPath } from '../core/photos.js';

const BUCKET = 'live-photos';

// 長い辺 1600px までに縮めた JPEG の Blob にする。再エンコードするので、撮った場所などの情報（EXIF）は残らない。
async function shrinkToJpeg(file, quality) {
  const bitmap = await createImageBitmap(file);
  try {
    const { w, h } = fitSize(bitmap.width, bitmap.height, 1600);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h);
    return await new Promise((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob'))), 'image/jpeg', quality);
    });
  } finally {
    bitmap.close?.();
  }
}

// 品質を下げながら、MAX_PHOTO_BYTES に収まる Blob を作る。収まらなければ断る。
export async function makePhotoBlob(file, shrink = shrinkToJpeg, maxBytes = MAX_PHOTO_BYTES) {
  for (const q of jpegQualitySteps()) {
    const blob = await shrink(file, q);
    if (blob.size <= maxBytes) return blob;
  }
  throw new Error(PHOTO_MSG.tooBig);
}

async function currentUserId(client) {
  const { data, error } = await client.auth.getSession();
  const id = data?.session?.user?.id;
  if (error || !id) throw new Error(PHOTO_MSG.failed);
  return id;
}

// deps はテスト用の差し替え口（client, userId, shrink, newId）。
export async function listPhotos(liveId, deps = {}) {
  const db = deps.client ?? getClient();
  const { data, error } = await db
    .from('live_photos')
    .select('id, storage_path')
    .eq('live_id', liveId)
    .order('position', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) throw error;
  const out = [];
  for (const row of data) {
    const { data: signed, error: e } = await db.storage.from(BUCKET).createSignedUrl(row.storage_path, PHOTO_URL_SECONDS);
    if (e || !signed?.signedUrl) continue; // URL が作れない行は除く
    out.push({ id: row.id, url: signed.signedUrl, storage_path: row.storage_path });
  }
  return out;
}

export async function addPhoto(liveId, file, deps = {}) {
  const db = deps.client ?? getClient();
  let blob;
  try {
    blob = await makePhotoBlob(file, deps.shrink);
  } catch (err) {
    if (err.message === PHOTO_MSG.tooBig) throw err;
    throw new Error(PHOTO_MSG.failed); // HEIC など、ブラウザが開けない画像
  }
  const userId = deps.userId ?? await currentUserId(db);
  const id = (deps.newId ?? (() => crypto.randomUUID()))();
  const path = photoPath(userId, liveId, id);
  const { error: insErr } = await db.from('live_photos').insert({ id, live_id: liveId, storage_path: path });
  if (insErr) {
    throw new Error(String(insErr.message ?? '').includes('PHOTO_LIMIT') ? PHOTO_MSG.limit : PHOTO_MSG.failed);
  }
  const { error: upErr } = await db.storage.from(BUCKET).upload(path, blob, { contentType: 'image/jpeg', upsert: false });
  if (upErr) {
    await db.from('live_photos').delete().eq('id', id); // 失敗しても、元のエラーを返す
    throw new Error(PHOTO_MSG.failed);
  }
  const { data: signed, error: sErr } = await db.storage.from(BUCKET).createSignedUrl(path, PHOTO_URL_SECONDS);
  if (sErr || !signed?.signedUrl) return { id, url: '', storage_path: path };
  return { id, url: signed.signedUrl, storage_path: path };
}

// ファイルを消してから行を消す（行を先に消すと、ファイルだけが残る）。
export async function deletePhoto(photo, deps = {}) {
  const db = deps.client ?? getClient();
  const { error } = await db.storage.from(BUCKET).remove([photo.storage_path]);
  if (error) throw error;
  const { error: e2 } = await db.from('live_photos').delete().eq('id', photo.id);
  if (e2) throw e2;
}

// ライブを消す前に、そのライブの写真のファイルを全部消す。消せなければ投げる（ライブは消さない）。
export async function removeLivePhotoFiles(liveId, db = getClient()) {
  const { data, error } = await db.from('live_photos').select('storage_path').eq('live_id', liveId);
  if (error) throw error;
  const paths = data.map((r) => r.storage_path);
  if (!paths.length) return;
  const { error: e2 } = await db.storage.from(BUCKET).remove(paths);
  if (e2) throw e2;
}
