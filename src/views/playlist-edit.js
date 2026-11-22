import { el, setChildren, backLink, loadView, trashIcon } from '../ui/dom.js';
import { getPlaylist, saveTracks, deletePlaylist, renamePlaylist } from '../data/playlists.js';
import { renderPlaylistConfirm } from './playlist-confirm.js';
import { getStatus, connect } from '../data/youtube.js';
import { playlistHref } from '../router.js';
import { needsReflect, deleteConfirmText, renameWhere } from '../core/playlist-list.js';
import { cleanName } from '../core/save-confirm.js';
import { moveTrackTo, maxDropIndex } from '../core/reorder.js';
import { attachDrag, cancelActiveDrag } from '../ui/drag-reorder.js';
import { replaceTrack, moveTrack, addManualTrack, hasPopularity } from '../core/prep.js';
import { renameTrack, addSetlistTrack } from '../core/setlist-edit.js';

const SAVE_FAILED = '保存できませんでした。通信を確かめてください';

// 編集モードでないときは、曲名だけの静かな行。編集モードでは、つまみ（≡）・上へ・下へ・消すが出る。
// 編集モードのときは { li, handle } を返す。
// setlist：曲名を押すと、その場で直せる。要確認の曲には印を付ける。
function setlistName(t, i, on, busy, rename) {
  if (rename?.index === i) {
    const okBtn = el('button', { type: 'button', class: 'primary', disabled: busy, text: '決める' });
    okBtn.addEventListener('click', rename.finish);
    const cancel = el('button', { type: 'button', disabled: busy, text: 'やめる' });
    cancel.addEventListener('click', rename.cancel);
    return el('span', { class: 'artist-name' }, el('span', { class: 'artist-edit song-rename' }, rename.input, okBtn, cancel));
  }
  const name = el('button', { type: 'button', class: 'song-title', disabled: busy, 'aria-label': `${t.title} の曲名を直す`, text: t.title });
  name.addEventListener('click', () => on.startRename(i));
  return el('span', { class: 'artist-name' },
    el('span', { class: 'num', text: `${i + 1}. ` }), name,
    t.uncertain ? el('span', { class: 'tag', text: '要確認' }) : null);
}

function trackRow(t, i, tracks, on, editing, busy, setlist = null) {
  const nameNode = () => (setlist
    ? setlistName(t, i, on, busy, setlist.rename)
    : el('span', { class: 'artist-name', text: `${i + 1}. ${t.title}` }));
  if (!editing) {
    return el('li', { class: 'artist-row' }, nameNode());
  }
  // 曲名を直している間は、並べ替え・消すを止める（行の位置がずれて、別の曲を直してしまわないように）。
  const locked = busy || (setlist?.rename.index ?? null) !== null;
  const trash = el('button', { type: 'button', class: 'trash', 'aria-label': `${t.title} を消す`, title: '消す', disabled: locked }, trashIcon());
  trash.addEventListener('click', () => on.remove(i));
  const handle = el('button', {
    type: 'button', class: 'handle', text: '≡', disabled: locked || t.isLatest, 'data-index': String(i),
    'aria-label': `${t.title} を並べ替える（引きずる。矢印キーの上下でも動かせます）`,
  });
  handle.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowUp') { e.preventDefault(); on.move(i, 'up'); }
    if (e.key === 'ArrowDown') { e.preventDefault(); on.move(i, 'down'); }
  });
  const li = el('li', { class: 'artist-row editing' },
    handle,
    nameNode(),
    trash);
  return { li, handle };
}

export function renderPlaylistEdit(container, ctx) {
  const id = ctx.params.id;
  if (ctx.query?.confirm === '1') { renderPlaylistConfirm(container, ctx); return; }
  const fromPrep = ctx.query?.from === 'prep';
  const confirmHref = playlistHref(id, { fromPrep, confirm: true });
  loadView(container, ctx, () => getPlaylist(id), (pl) => {
    if (!pl || !['prep', 'setlist'].includes(pl.kind)) {
      setChildren(container, backLink('#/prep', '戻る'), el('p', { class: 'note', text: 'このプレイリストは見つかりませんでした' }));
      return;
    }
    const isSetlist = pl.kind === 'setlist';
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
        focus.onOk?.();
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
        if (isSetlist) {
          // セトリは入れ替えの候補がない。消すと減るだけ。
          const next = tracks.filter((_, k) => k !== i);
          const at = { i: Math.min(i, next.length - 1), role: 'del' };
          persist(next, rest, { ok: at, fail: { i, role: 'del' } });
          return;
        }
        const r = replaceTrack(tracks, rest, i, pl.artist_name);
        // 消したあと：同じ場所に次の曲が入るので、その行の「消す」へ。失敗したら元の行の「消す」へ。
        const at = { i: Math.min(i, r.tracks.length - 1), role: 'del' };
        persist(r.tracks, r.rest, { ok: at, fail: { i, role: 'del' } });
      },
      move: (i, dir) => {
        const next = moveTrack(tracks, i, dir);
        if (next !== tracks) persist(next, rest, { ok: { i: i + (dir === 'up' ? -1 : 1), role: 'handle' }, fail: { i, role: 'handle' } });
      },
      startRename: (i) => {
        if (busy) return;
        renamingAt = i;
        songInput.value = tracks[i].title;
        message = '';
        draw();
        queueMicrotask(() => { songInput.focus(); songInput.select(); });
      },
      drop: (from, to) => {
        const next = moveTrackTo(tracks, from, to);
        if (next !== tracks) persist(next, rest);
      },
    };

    // セトリの曲名を直す。決めると「要確認」は外れる（同じ名前のまま決めても、確かめた印になる）。
    let renamingAt = null;
    const songInput = el('input', { type: 'text', maxlength: '100', 'aria-label': '曲名' });
    const rename = {
      get index() { return renamingAt; },
      input: songInput,
      finish: async () => {
        if (busy || renamingAt === null) return;
        if (!songInput.value.trim()) { message = '曲名を入れてください'; draw(); queueMicrotask(() => songInput.focus()); return; }
        const i = renamingAt;
        // 失敗したら入力欄を開いたまま（打った文字を残す）。成功したら閉じて、その行の曲名へフォーカスを戻す。
        const ok = await persist(renameTrack(tracks, i, songInput.value), rest, {
          ok: { i, role: 'title' }, onOk: () => { renamingAt = null; },
        });
        if (!ok && ctx.alive()) queueMicrotask(() => songInput.focus());
      },
      cancel: () => {
        const i = renamingAt;
        renamingAt = null;
        message = '';
        focusTo = { i, role: 'title' };
        draw();
        focusTo = null;
      },
    };
    songInput.addEventListener('keydown', (e) => {
      if (e.isComposing || e.keyCode === 229) return; // 変換の確定の Enter・Esc は無視する
      if (e.key === 'Enter') { e.preventDefault(); rename.finish(); }
      if (e.key === 'Escape') rename.cancel();
    });

    const add = async () => {
      if (isSetlist) {
        const next = addSetlistTrack(tracks, input.value, pl.artist_name);
        if (next.length === tracks.length) return;
        if (await persist(next, rest)) input.value = '';
        return;
      }
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

    // 名前を変える。保存済みなら保存の確認の画面へ（YouTube 側の名前もそろえる）。まだなら、ここで変える。
    let renaming = false;
    const nameInput = el('input', { type: 'text', maxlength: '150', 'aria-label': 'プレイリストの名前' });
    function startRename() {
      if (busy) return;
      if (renameWhere({ youtubePlaylistId: pl.youtube_playlist_id }) === 'confirm') { goSave(); return; }
      renaming = true;
      nameInput.value = pl.title;
      message = '';
      draw();
      queueMicrotask(() => { nameInput.focus(); nameInput.select(); });
    }
    async function finishRename() {
      const title = cleanName(nameInput.value);
      if (!title) { message = '名前を入れてください（150文字まで）'; draw(); return; }
      if (title === pl.title) { renaming = false; draw(); return; }
      busy = true;
      draw();
      try {
        await renamePlaylist(id, title);
        if (!ctx.alive()) return;
        pl.title = title;
        renaming = false;
        message = '';
        ctx.onPlaylistSaved?.();
      } catch {
        if (!ctx.alive()) return;
        message = '名前を変えられませんでした。通信を確かめてください';
      }
      busy = false;
      draw();
    }
    nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); finishRename(); }
      if (e.key === 'Escape') { renaming = false; message = ''; draw(); }
    });

    // 消したら来た画面（予習の一覧かライブの詳細）へ戻り、PC の左の一覧も読み直す。
    async function onDelete() {
      if (busy) return;
      if (!confirm(deleteConfirmText({ title: pl.title, youtubePlaylistId: pl.youtube_playlist_id }))) return;
      busy = true;
      message = '';
      draw();
      try {
        await deletePlaylist(id);
        if (!ctx.alive()) return;
        ctx.onPlaylistSaved?.();
        location.hash = back;
      } catch {
        if (!ctx.alive()) return;
        busy = false;
        message = '消せませんでした。通信を確かめて、もう一度押してください';
        draw();
      }
    }

    function titleBlock() {
      if (renaming) {
        const okBtn = el('button', { type: 'button', class: 'primary', disabled: busy, text: '決める' });
        okBtn.addEventListener('click', finishRename);
        const cancel = el('button', { type: 'button', disabled: busy, text: 'やめる' });
        cancel.addEventListener('click', () => { renaming = false; message = ''; draw(); });
        nameInput.disabled = busy;
        return [el('h1', { text: pl.title, class: 'visually-hidden' }), el('div', { class: 'artist-edit rename' }, nameInput, okBtn, cancel)];
      }
      const rename = el('button', { type: 'button', class: 'link', disabled: busy, text: '名前を変更' });
      rename.addEventListener('click', startRename);
      return [el('h1', { text: pl.title }), rename];
    }

    // セトリ：画像・文字から読み直す（置き換えの確かめは、読み取りの画面でする）。
    const reread = el('button', { type: 'button', class: 'link', text: '画像・文字から読み直す' });
    reread.addEventListener('click', () => {
      if (!busy && pl.live_id && pl.live_artist_id) location.hash = `#/live/${encodeURIComponent(pl.live_id)}/setlist/${encodeURIComponent(pl.live_artist_id)}`;
    });
    const canReread = isSetlist && Boolean(pl.live_id && pl.live_artist_id);

    function draw() {
      const typed = input.value;
      reread.disabled = busy;
      const list = el('ul', { class: 'list' });
      cancelActiveDrag();
      const maxIndex = maxDropIndex(tracks);
      tracks.forEach((t, i) => {
        const r = trackRow(t, i, tracks, on, editing, busy, isSetlist ? { rename } : null);
        const li = r.li ?? r;
        list.append(li);
        if (r.li) attachDrag(r.handle, r.li, list, { from: i, maxIndex, onDrop: on.drop });
        if (focusTo && focusTo.i === i) {
          const target = focusTo.role === 'title' ? li.querySelector('.song-title')
            : focusTo.role === 'del' ? li.querySelector('.trash') : r.handle;
          if (target) queueMicrotask(() => target.focus());
        }
      });
      const toggle = el('button', { type: 'button', text: editing ? '完了' : '編集', disabled: !editing && tracks.length === 0 });
      toggle.addEventListener('click', () => { editing = !editing; focusTo = 'toggle'; draw(); focusTo = null; });
      const save = el('button', { type: 'button', class: 'primary', disabled: busy || tracks.length === 0, text: pl.status === 'saved' ? 'YouTube Music に反映' : 'YouTube Music に保存' });
      save.addEventListener('click', goSave);
      const del = el('button', { type: 'button', class: 'danger delete-playlist', disabled: busy, text: 'このプレイリストを消す' });
      del.addEventListener('click', onDelete);
      setChildren(container,
        backLink(back, '戻る'),
        ...titleBlock(),
        unreflected ? el('p', { class: 'note', role: 'status', text: 'YouTube Music にまだ反映していません' }) : null,
        isSetlist && tracks.some((t) => t.uncertain) ? el('p', { class: 'note', text: '確かめてほしい曲に「要確認」が付いています。曲名を押すと直せます。' }) : null,
        canReread ? reread : null,
        !isSetlist && !hasPopularity(tracks, rest) ? el('p', { class: 'note', text: '人気の順のデータがないため、新しい順です' }) : null,
        list,
        !isSetlist && tracks.length < 10 ? el('p', { class: 'note', text: '候補がもうありません。曲名で探して足せます' }) : null,
        message ? el('p', { class: 'note error', role: 'alert', text: message }) : null,
        el('div', { class: 'artist-edit' }, input, addBtn),
        el('div', { class: 'actions' }, save, toggle),
        // 保存・編集と離して置く（押し間違えないように）。
        el('div', { class: 'actions' }, del));
      input.value = typed;
      if (focusTo === 'toggle') toggle.focus();
    }
    draw();
  });
}
