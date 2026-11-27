// ライブの詳細の「写真」の節。足す・大きく見る・消す。
import { el, setChildren, trashIcon } from '../ui/dom.js';
import { listPhotos, addPhoto, deletePhoto } from '../data/photos.js';
import { MAX_PHOTOS, canAddPhoto, PHOTO_MSG } from '../core/photos.js';
const KNOWN = new Set(Object.values(PHOTO_MSG));

const DELETE_CONFIRM = 'この写真を消しますか？';

export function renderLivePhotos(liveId, ctx) {
  const section = el('section', { class: 'live-photos' });
  let photos = [];
  let busy = false;
  let error = '';

  function show(big, opener) {
    const close = el('button', { type: 'button', class: 'live-photos-close', text: '閉じる' });
    const dialog = el('div', { class: 'live-photos-viewer', role: 'dialog', 'aria-modal': 'true', 'aria-label': '写真' },
      el('img', { src: big.url, alt: '写真' }), close);
    const done = (refocus = true) => {
      dialog.remove();
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('hashchange', onHash);
      if (refocus && opener?.isConnected) opener.focus();
    };
    const onHash = () => done(false);
    window.addEventListener('hashchange', onHash);
    const onKey = (e) => { if (e.key === 'Escape') done(); };
    close.addEventListener('click', () => done());
    dialog.addEventListener('click', (e) => { if (e.target === dialog) done(); });
    document.addEventListener('keydown', onKey);
    document.body.append(dialog);
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

  function draw() {
    const n = photos.length;
    const file = el('input', { type: 'file', accept: 'image/*', hidden: true, 'aria-label': '写真を選ぶ' });
    const add = canAddPhoto(n)
      ? el('button', { type: 'button', class: 'live-photos-add', disabled: busy, text: busy ? '保存中…' : '写真を足す' })
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
      const thumb = !p.url
        ? el('span', { class: 'live-photos-missing', text: '表示できません' })
        : el('button', { type: 'button', class: 'live-photos-thumb', disabled: busy, 'aria-label': `写真${i + 1}を大きく見る` },
        el('img', { src: p.url, alt: `写真${i + 1}`, loading: 'lazy' }));
      if (p.url) thumb.addEventListener('click', () => show(p, thumb));
      const del = el('button', { type: 'button', class: 'live-photos-del', disabled: busy, 'aria-label': `写真${i + 1}を消す` }, trashIcon());
      del.addEventListener('click', () => {
        if (!confirm(DELETE_CONFIRM)) return;
        run(async () => {
          await deletePhoto(p);
          photos = photos.filter((x) => x.id !== p.id);
        }, PHOTO_MSG.deleteFailed);
      });
      return el('li', { class: 'live-photos-item' }, thumb, del);
    });
    setChildren(section,
      el('h2', { text: `写真 ${n}/${MAX_PHOTOS}` }),
      n ? el('ul', { class: 'live-photos-grid' }, ...items) : null,
      add, file,
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
