import { el, setChildren, backLink, loadView } from '../ui/dom.js';
import { getPlaylist, saveTracks } from '../data/playlists.js';
import { renderPlaylistConfirm } from './playlist-confirm.js';
import { getStatus, connect } from '../data/youtube.js';
import { confirmReturnTo } from '../core/save-confirm.js';
import { needsReflect } from '../core/playlist-list.js';
import { replaceTrack, moveTrack, addManualTrack, hasPopularity } from '../core/prep.js';

const SAVE_FAILED = '保存できませんでした。通信を確かめてください';

function trackRow(t, i, tracks, on) {
  const btn = (label, fn, disabled) => {
    const b = el('button', { type: 'button', text: label, disabled });
    b.addEventListener('click', fn);
    return b;
  };
  return el('li', { class: 'artist-row' },
    el('span', { class: 'artist-name', text: `${i + 1}. ${t.title}` }),
    btn('消す', () => on.remove(i)),
    btn('↑', () => on.move(i, 'up'), i === 0 || t.isLatest),
    btn('↓', () => on.move(i, 'down'), i === tracks.length - 1 || t.isLatest || tracks[i + 1]?.isLatest));
}

export function renderPlaylistEdit(container, ctx) {
  const id = ctx.params.id;
  if (ctx.query?.confirm === '1') { renderPlaylistConfirm(container, ctx); return; }
  loadView(container, ctx, () => getPlaylist(id), (pl) => {
    if (!pl || pl.kind !== 'prep') {
      setChildren(container, backLink('#/prep', '戻る'), el('p', { class: 'note', text: 'このプレイリストは見つかりませんでした' }));
      return;
    }
    const back = pl.live_id ? `#/live/${encodeURIComponent(pl.live_id)}` : '#/prep';
    let tracks = pl.tracks;
    let rest = pl.candidates ?? { popular: [], recent: [] };
    let message = '';
    let busy = false;
    // 保存済みで、保存のあとに曲を変えたら、YouTube Music にまだ反映していない。
    let unreflected = needsReflect({ status: pl.status, savedAt: pl.saved_at, editedAt: pl.edited_at });
    const input = el('input', { type: 'text', maxlength: '100', placeholder: '曲名', 'aria-label': '足す曲名' });

    // 成功なら true。失敗したら変更前（prev）に戻してエラーを出す（サーバーの状態には頼らない。保存は丸ごと入れ替えなので、失敗なら元のまま）。
    const persist = async (next, nextRest) => {
      if (busy) return false;
      busy = true;
      const prev = { tracks, rest };
      tracks = next;
      rest = nextRest;
      message = '';
      draw();
      let ok = true;
      try {
        await saveTracks(id, tracks, rest);
        if (pl.status === 'saved') unreflected = true;
      } catch {
        ({ tracks, rest } = prev);
        message = SAVE_FAILED;
        ok = false;
      }
      busy = false;
      if (ctx.alive()) draw();
      return ok;
    };

    const on = {
      remove: (i) => {
        const r = replaceTrack(tracks, rest, i, pl.artist_name);
        persist(r.tracks, r.rest);
      },
      move: (i, dir) => {
        const next = moveTrack(tracks, i, dir);
        if (next !== tracks) persist(next, rest);
      },
    };

    const add = async () => {
      const r = addManualTrack(tracks, input.value, pl.artist_name);
      if (r.duplicate) { message = '同じ曲がもう入っています'; draw(); return; }
      if (r.tracks === tracks) return;
      if (await persist(r.tracks, rest)) input.value = '';
    };
    const addBtn = el('button', { type: 'button', text: '足す' });
    addBtn.addEventListener('click', add);

    // つながっていれば確認の画面へ。つながっていなければ、つないでから確認の画面へ戻る。
    async function goSave() {
      if (busy) return;
      busy = true;
      message = '';
      draw();
      try {
        const { connected } = await getStatus();
        if (!ctx.alive()) return;
        if (connected) {
          busy = false;
          location.hash = confirmReturnTo(id);
          return;
        }
        await connect(confirmReturnTo(id));
      } catch {
        if (!ctx.alive()) return;
        busy = false;
        message = 'YouTube の状態を確かめられませんでした。通信を確かめてください';
        draw();
      }
    }

    function draw() {
      const typed = input.value;
      const save = el('button', { type: 'button', class: 'primary', disabled: busy || tracks.length === 0, text: pl.status === 'saved' ? 'YouTube Music に反映' : 'YouTube Music に保存' });
      save.addEventListener('click', goSave);
      setChildren(container,
        backLink(back, '戻る'),
        el('h1', { text: pl.title }),
        unreflected ? el('p', { class: 'note', role: 'status', text: 'YouTube Music にまだ反映していません' }) : null,
        !hasPopularity(tracks, rest) ? el('p', { class: 'note', text: '人気の順のデータがないため、新しい順です' }) : null,
        el('ul', { class: 'list' }, ...tracks.map((t, i) => trackRow(t, i, tracks, on))),
        tracks.length < 10 ? el('p', { class: 'note', text: '候補がもうありません。曲名で探して足せます' }) : null,
        message ? el('p', { class: 'note error', role: 'alert', text: message }) : null,
        el('div', { class: 'artist-edit' }, input, addBtn),
        el('div', { class: 'actions' }, save));
      input.value = typed;
    }
    draw();
  });
}
