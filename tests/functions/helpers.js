import { fakeDb } from './fake-db.js';

export const ORIGIN = 'http://localhost:8080';
export const NOW = new Date('2026-11-17T00:00:00Z');
export const daysAgo = (n) => new Date(NOW.getTime() - n * 86400000).toISOString();

export function makeDeps({ fetchMap = () => { throw new Error('no fetch'); }, env = {}, tables = {}, allowed = true, errors = {} } = {}) {
  const calls = [];
  const db = fakeDb({
    users: { goodjwt: { id: 'u1', email: ' Me@Example.COM ' } },
    errors,
    tables: { allowed_emails: allowed ? [{ email: 'me@example.com' }] : [], ...tables },
  });
  const fetch = async (url) => {
    calls.push(String(url));
    const r = await fetchMap(String(url));
    return {
      ok: r.status === undefined || r.status === 200,
      status: r.status ?? 200,
      json: async () => r.body,
    };
  };
  return { deps: { fetch, db, env: (k) => env[k], now: () => NOW }, calls, db };
}

export const post = (body, { jwt = 'goodjwt', origin = ORIGIN } = {}) =>
  new Request('http://fn/x', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin, ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}) },
    body: JSON.stringify(body),
  });
