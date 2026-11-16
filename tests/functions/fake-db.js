// テスト用の小さな偽 db。使う呼び出しだけ：
//   auth.getUser(jwt) / from(t).select(cols).eq(col, v).maybeSingle() / from(t).upsert(row)
export function fakeDb({ users = {}, tables = {} } = {}) {
  const upserts = [];
  const db = {
    upserts,
    tables,
    auth: {
      async getUser(jwt) {
        const user = users[jwt];
        return user ? { data: { user }, error: null } : { data: { user: null }, error: { message: 'invalid' } };
      },
    },
    from(table) {
      return {
        select() {
          return {
            eq(col, v) {
              return {
                async maybeSingle() {
                  const row = (tables[table] ?? []).find((r) => r[col] === v) ?? null;
                  return { data: row, error: null };
                },
              };
            },
          };
        },
        async upsert(row) {
          upserts.push({ table, row });
          const rows = (tables[table] ??= []);
          const i = rows.findIndex((r) => r.artist_key === row.artist_key);
          if (i >= 0) rows[i] = row; else rows.push(row);
          return { error: null };
        },
      };
    },
  };
  return db;
}
