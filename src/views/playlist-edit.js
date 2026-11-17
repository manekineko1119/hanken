import { el, setChildren, backLink, loadView, trashIcon } from '../ui/dom.js';
import { getPlaylist, saveTracks } from '../data/playlists.js';
import { renderPlaylistConfirm } from './playlist-confirm.js';
import { getStatus, connect } from '../data/youtube.js';
import { playlistHref } from '../router.js';
import { needsReflect } from '../core/playlist-list.js';
import { moveTrackTo, maxDropIndex } from '../core/reorder.js';
import { attachDrag, cancelActiveDrag } from '../ui/drag-reorder.js';
import { replaceTrack, moveTrack, addManualTrack, hasPopularity } from '../core/prep.js';

const SAVE_FAILED = '保存できませんでした。通信を確かめてください';

// 編集モードでないときは、曲名だけの静かな行。編集モードでは、つまみ（≡）・上へ・下へ・消すが出る。
// 編集モードのときは { li, handle } を返す。
function trackRow(t, i, tracks, on, editing, busy) {
  if (!editing) {
    return el('li', { class: 'artist-row' }, el('span', { class: 'artist-name', text: `${i + 1}. ${t.title}` }));
  }
  const trash = el('button', { type: 'button', class: 'trash', 'aria-label': `${t.title} を消す`, title: '消す', disabled: busy }, trashIcon());
  trash.addEventListener('click', () => on.remove(i));
  const handle = el('button', {
    type: 'button', class: 'handle', text: '≡', disabled: busy || t.isLatest, 'data-index': String(i),
    'aria-label': `${t.title} を並べ替える（引きずる。矢印キーの上下でも動かせます）`,
  });
  handle.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowUp') { e.preventDefault(); on.move(i, 'up'); }
    if (e.key === 'ArrowDown') { e.preventDefault(); on.move(i, 'down'); }
  });
  const li = el('li', { class: 'artist-row editing' },
    handle,
    el('span', { class: 'artist-name', text: `${i + 1}. ${t.title}` }),
    trash);
  return { li, handle };
}

export function renderPlaylistEdit(container, ctx) {
  const id = ctx.params.id;
  if (ctx.query?.confirm === '1') { renderPlaylistConfirm(container, ctx); return; }
  const fromPrep = ctx.query?.from === 'prep';
  const confirmHref = playlistHref(id, { fromPrep, confirm: true });
  loadView(container, ctx, () => getPlaylist(id), (pl) => {
    if (!pl || pl.kind !== 'prep') {
      setChildren(container, backLink('#/prep', '戻る'), el('p', { class: 'note', text: 'このプレイリストは見つかりませんでした' }));
      return;
    }
    const back = !fromPrep && pl.live_id ? `#/live/${encodeURIComponent(pl.live_id)}` : '#/prep';
    let tracks = pl.tracks;
    let rest = pl.candidates ?? { popular: [], recent: [] };
    let message = '';
    let busy = false;
    let editing = false;
    // 作り直したあとにフォーカスを戻す先：{ i: 行, role: 'handle' | 'del' } か 'toggle'
    let focusTo = null;
    // 保存済みで、保存のあとに曲を変えたら、YouTube Music にまだ反映していない。
    let unreflected = needsReflect({ status: pl.status, savedAt: pl.saved_at, editedAt: pl.edited_at });
    const input = el('input', { type: 'text', maxlength: '100', placeholder: '曲名', 'aria-label': '足す曲名' });

    // 成功なら true。失敗したら変更前（prev）に戻してエラーを出す（サーバーの状態には頼らない。保存は丸ごと入れ替えなので、失敗なら元のまま）。
    const persist = async (next, nextRest, focus = {}) => {
      if (busy) { focusTo = null; return false; }
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
      focusTo = (ok ? focus.ok : focus.fail) ?? null;
      if (ctx.alive()) draw();
      focusTo = null;
      return ok;
    };

    const on = {
      remove: (i) => {
        const r = replaceTrack(tracks, rest, i, pl.artist_name);
        // 消したあと：同じ場所に次の曲が入るので、その行の「消す」へ。失敗したら元の行の「消す」へ。
        const at = { i: Math.min(i, r.tracks.length - 1), role: 'del' };
        persist(r.tracks, r.rest, { ok: at, fail: { i, role: 'del' } });
      },
      move: (i, dir) => {
        const next = moveTrack(tracks, i, dir);
        if (next !== tracks) persist(next, rest, { ok: { i: i + (dir === 'up' ? -1 : 1), role: 'handle' }, fail: { i, role: 'handle' } });
      },
      drop: (from, to) => {
        const next = moveTrackTo(tracks, from, to);
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
          location.hash = confirmHref;
          return;
        }
        await connect(confirmHref);
      } catch {
        if (!ctx.alive()) return;
        busy = false;
        message = 'YouTube の状態を確かめられませんでした。通信を確かめてください';
        draw();
      }
    }

    function draw() {
      const typed = input.value;
      const list = el('ul', { class: 'list' });
      cancelActiveDrag();
      const maxIndex = maxDropIndex(tracks);
      tracks.forEach((t, i) => {
        const r = trackRow(t, i, tracks, on, editing, busy);
        if (r.li) {
          list.append(r.li);
          attachDrag(r.handle, r.li, list, { from: i, maxIndex, onDrop: on.drop });
          if (focusTo && focusTo.i === i) {
            const target = focusTo.role === 'del' ? r.li.querySelector('.trash') : r.handle;
            queueMicrotask(() => target.focus());
          }
        } else {
          list.append(r);
        }
      });
      const toggle = el('button', { type: 'button', text: editing ? '完了' : '編集', disabled: !editing && tracks.length === 0 });
      toggle.addEventListener('click', () => { editing = !editing; focusTo = 'toggle'; draw(); focusTo = null; });
      const save = el('button', { type: 'button', class: 'primary', disabled: busy || tracks.length === 0, text: pl.status === 'saved' ? 'YouTube Music に反映' : 'YouTube Music に保存' });
      save.addEventListener('click', goSave);
      setChildren(container,
        backLink(back, '戻る'),
        el('h1', { text: pl.title }),
        unreflected ? el('p', { class: 'note', role: 'status', text: 'YouTube Music にまだ反映していません' }) : null,
        !hasPopularity(tracks, rest) ? el('p', { class: 'note', text: '人気の順のデータがないため、新しい順です' }) : null,
        list,
        tracks.length < 10 ? el('p', { class: 'note', text: '候補がもうありません。曲名で探して足せます' }) : null,
        message ? el('p', { class: 'note error', role: 'alert', text: message }) : null,
        el('div', { class: 'artist-edit' }, input, addBtn),
        el('div', { class: 'actions' }, save, toggle));
      input.value = typed;
      if (focusTo === 'toggle') toggle.focus();
    }
    draw();
  });
}
