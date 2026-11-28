// ライブの詳細の「写真」の節。足す・大きく（スライドで）見る・選んで消す。
import { el, setChildren } from '../ui/dom.js';
import { listPhotos, addPhoto, deletePhoto } from '../data/photos.js';
import { MAX_PHOTOS, canAddPhoto, PHOTO_MSG, nextIndex, toggleSelected, deleteLabel, deleteConfirm } from '../core/photos.js';
const KNOWN = new Set(Object.values(PHOTO_MSG));

const SWIPE_PX = 40;

export function renderLivePhotos(liveId, ctx) {
  const section = el('section', { class: 'live-photos' });
  let photos = [];
  let busy = false;
  let error = '';
  let selecting = false;
  let selected = new Set();

  // 大きく見る。URL のある写真だけが並ぶ（表示できない行は飛ばす）
  function show(startId, opener) {
    const seq = photos.filter((p) => p.url);
    let idx = Math.max(0, seq.findIndex((p) => p.id === startId));
    const counter = el('p', { class: 'live-photos-counter', 'aria-live': 'polite' });
    const img = el('img', { src: seq[idx].url, alt: '写真' });
    const prev = el('button', { type: 'button', class: 'live-photos-prev', 'aria-label': '前の写真', text: '‹' });
    const next = el('button', { type: 'button', class: 'live-photos-next', 'aria-label': '次の写真', text: '›' });
    const close = el('button', { type: 'button', class: 'live-photos-close', text: '閉じる' });
    const stage = el('div', { class: 'live-photos-stage' }, prev, img, next);
    // <dialog>＋showModal()：フォーカスは中に閉じ込められ、Escape は標準で閉じる（close イベントで後片付け）
    const dialog = el('dialog', { class: 'live-photos-viewer', 'aria-label': '写真' }, counter, stage, close);

    function update() {
      img.src = seq[idx].url;
      counter.textContent = `${idx + 1} / ${seq.length}`;
      prev.disabled = idx === 0;
      next.disabled = idx === seq.length - 1;
    }
    function go(dir) {
      const i = nextIndex(idx, seq.length, dir);
      if (i === idx) return;
      const was = document.activeElement;
      idx = i;
      update();
      // 端のボタンが無効になるとき、フォーカスが消えないよう閉じるボタンへ
      if ((was === prev && prev.disabled) || (was === next && next.disabled)) close.focus();
    }
    update();

    let refocus = true;
    const onHash = () => { refocus = false; dialog.close(); };
    dialog.addEventListener('close', () => {
      window.removeEventListener('hashchange', onHash);
      dialog.remove();
      if (refocus && opener?.isConnected) opener.focus();
    });
    window.addEventListener('hashchange', onHash);
    close.addEventListener('click', () => dialog.close());
    prev.addEventListener('click', () => go(-1));
    next.addEventListener('click', () => go(1));
    dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
    dialog.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
    });
    // 指でめくる：横に 40px 以上、縦より横に動いたとき
    let start = null;
    stage.addEventListener('pointerdown', (e) => { start = { x: e.clientX, y: e.clientY }; });
    stage.addEventListener('pointercancel', () => { start = null; });
    stage.addEventListener('pointerup', (e) => {
      if (!start) return;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      start = null;
      if (Math.abs(dx) >= SWIPE_PX && Math.abs(dx) > Math.abs(dy)) go(dx < 0 ? 1 : -1);
    });
    document.body.append(dialog);
    dialog.showModal();
    close.focus();
  }

  async function run(task, fallback) {
    busy = true; error = '';
    draw();
    try {
      await task();
    } catch (err) {
      error = KNOWN.has(err?.message) ? err.message : fallback;
    }
    if (!ctx.alive()) return;
    busy = false;
    draw();
  }

  function leaveSelecting() { selecting = false; selected = new Set(); error = ''; draw(); }

  // 選んだ写真を1枚ずつ消す。失敗したものは選んだまま残す
  async function deleteSelected() {
    const targets = photos.filter((p) => selected.has(p.id));
    if (!targets.length || !confirm(deleteConfirm(targets.length))) return;
    await run(async () => {
      const failed = new Set();
      for (const p of targets) {
        try {
          await deletePhoto(p);
          photos = photos.filter((x) => x.id !== p.id);
        } catch { failed.add(p.id); }
      }
      selected = failed;
      if (!failed.size || !photos.length) { selecting = false; selected = new Set(); }
      if (failed.size) throw new Error(PHOTO_MSG.deletePartial);
    }, PHOTO_MSG.deleteFailed);
  }

  function draw() {
    const n = photos.length;
    const file = el('input', { type: 'file', accept: 'image/*', hidden: true, 'aria-label': '写真を選ぶ' });
    const add = canAddPhoto(n)
      ? el('button', { type: 'button', class: 'live-photos-add', disabled: busy || selecting, text: busy ? '保存中…' : '写真を追加' })
      : null;
    if (add) {
      add.addEventListener('click', () => file.click());
      file.addEventListener('change', () => {
        const f = file.files?.[0];
        if (!f) return;
        run(async () => { photos = [...photos, await addPhoto(liveId, f)]; }, PHOTO_MSG.failed);
      });
    }
    const items = photos.map((p, i) => {
      let tile;
      if (selecting) {
        const on = selected.has(p.id);
        tile = el('button', {
          type: 'button', class: `live-photos-thumb live-photos-select${on ? ' is-selected' : ''}`,
          disabled: busy, 'aria-pressed': on ? 'true' : 'false', 'aria-label': `写真${i + 1}を選ぶ`,
        },
        p.url ? el('img', { src: p.url, alt: '' }) : el('span', { class: 'live-photos-missing', text: '表示できません' }),
        el('span', { class: 'live-photos-check', 'aria-hidden': 'true', text: on ? '✓' : '' }));
        tile.addEventListener('click', () => { selected = toggleSelected(selected, p.id); draw(); });
      } else if (!p.url) {
        tile = el('span', { class: 'live-photos-missing', text: '表示できません' });
      } else {
        tile = el('button', { type: 'button', class: 'live-photos-thumb', disabled: busy, 'aria-label': `写真${i + 1}を大きく見る` },
          el('img', { src: p.url, alt: `写真${i + 1}`, loading: 'lazy' }));
        tile.addEventListener('click', () => show(p.id, tile));
      }
      return el('li', { class: 'live-photos-item' }, tile);
    });

    let selectBar = null;
    let enter = null;
    if (selecting) {
      const del = el('button', { type: 'button', class: 'live-photos-delete', disabled: busy || selected.size === 0, text: deleteLabel(selected.size) });
      const cancel = el('button', { type: 'button', class: 'live-photos-cancel', disabled: busy, text: 'キャンセル' });
      del.addEventListener('click', deleteSelected);
      cancel.addEventListener('click', leaveSelecting);
      selectBar = el('div', { class: 'live-photos-actions' },
        el('p', { class: 'note', text: '写真を選んでください' }), del, cancel);
    } else if (n) {
      enter = el('button', { type: 'button', class: 'live-photos-enter', disabled: busy, text: '写真を削除' });
      enter.addEventListener('click', () => { selecting = true; selected = new Set(); error = ''; draw(); });
    }
    setChildren(section,
      el('h2', { text: `写真 ${n}/${MAX_PHOTOS}` }),
      n ? el('ul', { class: 'live-photos-grid' }, ...items) : null,
      selectBar,
      el('div', { class: 'live-photos-actions' }, add, enter),
      file,
      error ? el('p', { class: 'note error', role: 'alert', text: error }) : null,
    );
  }

  draw();
  (async () => {
    try { photos = await listPhotos(liveId); } catch { error = PHOTO_MSG.loadFailed; }
    if (ctx.alive()) draw();
  })();
  return section;
}
