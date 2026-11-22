import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import { handle } from './handler.js';
import { errorJson } from '../_shared/http.js';

const env = (k) => Deno.env.get(k);
const db = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
  auth: { persistSession: false, autoRefreshToken: false },
});
const deps = { fetch: (...a) => fetch(...a), db, env, now: () => new Date() };

Deno.serve(async (req) => {
  try {
    return await handle(req, deps);
  } catch (e) {
    // 秘密の値・画像・読めた文字を出さないよう、種類だけ記録する。
    console.error('unhandled error', e?.name ?? 'Error');
    return errorJson('UPSTREAM', 'サーバーでエラーが起きました', 500, req.headers.get('Origin'), env);
  }
});
