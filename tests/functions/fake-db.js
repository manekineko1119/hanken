// テスト用の小さな偽 db。使う呼び出しだけ：
//   auth.getUser(jwt)
//   from(t).select(cols).eq(col, v)...[.order(col)] を await（配列）／.maybeSingle()
//   from(t).update(patch).eq(col, v)... を await
//   from(t).upsert(row) …… 主キー（PK_COLS）が同じ行は置き換える
const PK_COLS = {
  track_cache: ['artist_key'],
  video_cache: ['artist_key', 'title_key'],
  api_usage: ['day_pt'],
  user_daily_usage: ['user_id', 'day_jst', 'kind'],
};

export function fakeDb({ users = {}, tables = {}, errors = {} } = {}) {
  const upserts = [];
  const updates = [];
  const matchAll = (filters) => (r) => filters.every(([c, v]) => r[c] === v);
  const db = {
    upserts,
    updates,
    tables,
    auth: {
      async getUser(jwt) {
        const user = users[jwt];
        return user ? { data: { user }, error: null } : { data: { user: null }, error: { message: 'invalid' } };
      },
    },
    from(table) {
      const filters = [];
      let orderCol = null;
      let patch = null;
      const run = () => {
        if (errors[table]) return { data: null, error: errors[table] };
        let rows = (tables[table] ??= []).filter(matchAll(filters));
        if (patch) {
          rows.forEach((r) => Object.assign(r, patch));
          updates.push({ table, patch, filters: [...filters] });
          return { data: null, error: null };
        }
        if (orderCol) rows = [...rows].sort((a, b) => (a[orderCol] ?? 0) - (b[orderCol] ?? 0));
        return { data: rows, error: null };
      };
      const q = {
        select() { return q; },
        update(p) { patch = p; return q; },
        eq(col, v) { filters.push([col, v]); return q; },
        order(col) { orderCol = col; return q; },
        async maybeSingle() {
          const r = run();
          return r.error ? r : { data: r.data[0] ?? null, error: null };
        },
        then(resolve, reject) { return Promise.resolve(run()).then(resolve, reject); },
        async upsert(row) {
          if (errors[table]) return { error: errors[table] };
          upserts.push({ table, row });
          const rows = (tables[table] ??= []);
          const keys = PK_COLS[table] ?? ['artist_key'];
          const i = rows.findIndex((r) => keys.every((k) => r[k] === row[k]));
          if (i >= 0) rows[i] = row; else rows.push(row);
          return { error: null };
        },
      };
      return q;
    },
  };
  return db;
}
