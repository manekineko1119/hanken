import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import { handle } from './handler.js';

const env = (k) => Deno.env.get(k);
const db = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
  auth: { persistSession: false, autoRefreshToken: false },
});
const deps = { fetch: (...a) => fetch(...a), db, env, now: () => new Date() };

Deno.serve((req) => handle(req, deps));
