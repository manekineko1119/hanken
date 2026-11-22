// テスト用の小さな偽 db。使う呼び出しだけ：
//   auth.getUser(jwt)
//   from(t).select(cols).eq(col, v)...[.order(col)] を await（配列）／.maybeSingle()
//   from(t).update(patch).eq(col, v)... を await
//   from(t).upsert(row) …… 主キー（PK_COLS）が同じ行は置き換える
//   from(t).insert(row) を await ／ from(t).delete().eq(col, v)... を await
const PK_COLS = {
  youtube_connections: ['user_id'],
  track_cache: ['artist_key'],
  video_cache: ['artist_key', 'title_key'],
  api_usage: ['day_pt'],
  user_daily_usage: ['user_id', 'day_jst', 'kind'],
  vision_usage: ['month_pt'],
};

export function fakeDb({ users = {}, tables = {}, errors = {} } = {}) {
  const upserts = [];
  const updates = [];
  const rpcCalls = [];
  const lockCalls = []; // claim/release_playlist_save の呼び出し（順番の確認用）
  const matchAll = (filters) => (r) => filters.every(([c, v]) => r[c] === v);
  const db = {
    upserts,
    updates,
    rpcCalls,
    lockCalls,
    tables,
    auth: {
      async getUser(jwt) {
        const user = users[jwt];
        return user ? { data: { user }, error: null } : { data: { user: null }, error: { message: 'invalid' } };
      },
    },
    // increment_usage の偽物（SQL 関数と同じ足し方）
    async rpc(name, a) {
      if (errors.rpc) return { data: null, error: errors.rpc };
      // claim/release_playlist_save の偽物（SQL 関数と同じ：持ち主の行で、鍵が空か期限切れのときだけ取る）
      if (name === 'claim_playlist_save' || name === 'release_playlist_save') {
        lockCalls.push({ name, ...a });
        const row = (tables.playlists ??= []).find((r) => r.id === a.p_playlist_id && r.user_id === a.p_user_id);
        if (name === 'release_playlist_save') {
          if (row) row.save_locked_until = null;
          return { data: null, error: null };
        }
        if (!row || (row.save_locked_until && Date.parse(row.save_locked_until) > Date.now())) return { data: false, error: null };
        row.save_locked_until = new Date(Date.now() + a.p_seconds * 1000).toISOString();
        return { data: true, error: null };
      }
      // reserve_vision の偽物（SQL 関数と同じ判定：月 800 枚 → 一人 1 日 10 回の順。通ったときだけ両方に足す）
      if (name === 'reserve_vision') {
        rpcCalls.push({ name, ...a });
        if (a.p_user_id == null || a.p_day_jst == null || a.p_month_pt == null) throw new Error('null argument');
        if (!Number.isInteger(a.p_images) || a.p_images < 1 || a.p_images > 4) throw new Error('p_images must be 1..4');
        const vrows = (tables.vision_usage ??= []);
        let m = vrows.find((r) => r.month_pt === a.p_month_pt);
        if (!m) vrows.push((m = { month_pt: a.p_month_pt, images: 0 }));
        if (m.images + a.p_images > 800) return { data: 'month', error: null };
        const urows = (tables.user_daily_usage ??= []);
        let u = urows.find((r) => r.user_id === a.p_user_id && r.day_jst === a.p_day_jst && r.kind === 'setlist');
        if ((u?.count ?? 0) >= 10) return { data: 'day', error: null };
        m.images += a.p_images;
        if (!u) urows.push((u = { user_id: a.p_user_id, day_jst: a.p_day_jst, kind: 'setlist', count: 0 }));
        u.count += 1;
        return { data: 'ok', error: null };
      }
      if (name !== 'increment_usage') throw new Error('unexpected rpc ' + name);
      rpcCalls.push(a);
      const find = (t, pred, make) => {
        const rows = (tables[t] ??= []);
        let r = rows.find(pred);
        if (!r) rows.push((r = make()));
        return r;
      };
      const u = find('user_daily_usage', (r) => r.user_id === a.p_user_id && r.day_jst === a.p_day_jst && r.kind === a.p_kind,
        () => ({ user_id: a.p_user_id, day_jst: a.p_day_jst, kind: a.p_kind, count: 0 }));
      const g = find('api_usage', (r) => r.day_pt === a.p_day_pt, () => ({ day_pt: a.p_day_pt, units: 0, searches: 0 }));
      u.count = Math.max(0, u.count + a.p_searches);
      if (a.p_kind === 'search') g.searches = Math.max(0, g.searches + a.p_searches);
      g.units = Math.max(0, g.units + a.p_units);
      return { data: [{ user_count: u.count, global_searches: g.searches, global_units: g.units }], error: null };
    },
    from(table) {
      const filters = [];
      let orderCol = null;
      let patch = null;
      let removing = false;
      const run = () => {
        if (errors[table]) return { data: null, error: errors[table] };
        if (removing) {
          const all = (tables[table] ??= []);
          tables[table] = all.filter((r) => !matchAll(filters)(r));
          return { data: null, error: null };
        }
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
        delete() { removing = true; return q; },
        async insert(row) {
          if (errors[table]) return { error: errors[table] };
          (tables[table] ??= []).push(...(Array.isArray(row) ? row : [row]));
          return { error: null };
        },
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
