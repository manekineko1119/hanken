import { prelude, readJson, json, errorJson } from '../_shared/http.js';
import { jstDay, ptDay } from '../_shared/quota.js';
import { VISION_URL, visionBody, linesFromVision } from '../_shared/vision.js';

const TIMEOUT_MS = 20000;
const MAX_IMAGES = 4;
const MAX_TOTAL_CHARS = 4 * 1024 * 1024; // base64 の文字数の合計（設計 8.2「合わせて 4MB」）

// 画像と読めた文字は、ログにも、エラーの文面にも出さない（F2-05）。ここでは固定の文面だけを使う。
export async function handle(req, deps) {
  const p = await prelude(req, deps);
  if (p.response) return p.response;
  const { user, origin } = p;
  const err = (code, msg, status) => errorJson(code, msg, status, origin, deps.env);

  // ① 入力を確かめる（何かを呼ぶ前に）
  const body = await readJson(req);
  const images = body?.images;
  if (!Array.isArray(images) || images.length < 1 || images.length > MAX_IMAGES
    || !images.every((s) => typeof s === 'string' && s.length > 0)) {
    return err('BAD_INPUT', '画像は1〜4枚で送ってください', 400);
  }
  if (images.reduce((n, s) => n + s.length, 0) > MAX_TOTAL_CHARS) {
    return err('BAD_INPUT', '画像が大きすぎます（合わせて 4MB まで）', 400);
  }

  // キーがなければ、数える前に止める（読めないのに枚数だけ減らさない）。
  const key = deps.env('VISION_API_KEY');
  if (!key) return err('UPSTREAM', '読み取りの設定がありません', 502);

  // ② 先に数える。足せなければ、Cloud Vision を呼ばない。ここから先の失敗でも戻さない（N-13）。
  const now = deps.now();
  const monthPt = `${ptDay(now).slice(0, 7)}-01`;
  let verdict;
  try {
    const r = await deps.db.rpc('reserve_vision', {
      p_user_id: user.id, p_day_jst: jstDay(now), p_month_pt: monthPt, p_images: images.length,
    });
    if (r.error) throw new Error('reserve failed');
    verdict = r.data;
  } catch {
    return err('UPSTREAM', '読み取りの回数を確かめられませんでした', 502);
  }
  if (verdict === 'month' || verdict === 'day') {
    // 上限は決まりどおりの動きなので 200 で返す（429 にすると、ブラウザが毎回赤いエラーを出す）。
    return json({ error: 'LIMIT', scope: verdict }, 200, origin, deps.env);
  }
  if (verdict !== 'ok') return err('UPSTREAM', '読み取りの回数を確かめられませんでした', 502);

  // ③ Cloud Vision を呼ぶ ④ 行にして返す
  try {
    const res = await deps.fetch(`${VISION_URL}?key=${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(visionBody(images)),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return err('UPSTREAM', '画像を読み取れませんでした', 502);
    const lines = linesFromVision(await res.json());
    return json({ lines }, 200, origin, deps.env);
  } catch {
    // 失敗・タイムアウト・返事の形の違いは、すべて同じ扱い。中身は記録しない。
    return err('UPSTREAM', '画像を読み取れませんでした', 502);
  }
}
