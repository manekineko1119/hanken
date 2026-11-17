import { fakeDb } from './fake-db.js';

export const ORIGIN = 'http://localhost:8080';
export const NOW = new Date('2026-11-17T00:00:00Z');
export const daysAgo = (n) => new Date(NOW.getTime() - n * 86400000).toISOString();

export function makeDeps({ fetchMap = () => { throw new Error('no fetch'); }, env = {}, tables = {}, allowed = true, errors = {} } = {}) {
  const calls = [];
  const reqs = []; // { url, method, body, headers }
  const db = fakeDb({
    users: { goodjwt: { id: 'u1', email: ' Me@Example.COM ' } },
    errors,
    tables: { allowed_emails: allowed ? [{ email: 'me@example.com' }] : [], ...tables },
  });
  const fetch = async (url, init = {}) => {
    calls.push(String(url));
    reqs.push({ url: String(url), method: init.method ?? 'GET', body: init.body ? JSON.parse(init.body) : null, headers: init.headers });
    const r = await fetchMap(String(url), init);
    return {
      ok: (r.status ?? 200) >= 200 && (r.status ?? 200) < 300,
      status: r.status ?? 200,
      json: async () => r.body,
    };
  };
  return { deps: { fetch, db, env: (k) => env[k], now: () => NOW }, calls, reqs, db };
}

export const post = (body, { jwt = 'goodjwt', origin = ORIGIN } = {}) =>
  new Request('http://fn/x', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin, ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}) },
    body: JSON.stringify(body),
  });
