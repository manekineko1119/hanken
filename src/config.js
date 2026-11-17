// Supabase の接続先。ホスト名で自動的に選ぶので、手で書き換えない。
// 公開してよい publishable key だけを置く（secret key は絶対に入れない）。
export function pickConfig(hostname) {
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    // Supabase CLI の固定のローカル用 publishable key（公開されている値）。
    return { url: 'http://127.0.0.1:55321', key: 'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH' };
  }
  // 本番（GitHub Pages）。publishable key は公開してよい値。
  return { url: 'https://zggkdnisdkspuwbelflo.supabase.co', key: 'sb_publishable_7_aem7wuSAl15JcUS1ikOw_3I6H5PUO' };
}

const picked = pickConfig(globalThis.location?.hostname);
export const SUPABASE_URL = picked.url;
export const SUPABASE_PUBLISHABLE_KEY = picked.key;
