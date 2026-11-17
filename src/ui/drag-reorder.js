// ≡ のつまみを引きずって、リストの行を並べ替える（Pointer Events。HTML5 の drag and drop は使わない）。
// つまみは touch-action: none（CSS）。行そのものは普通にスクロールできる。
import { dropIndex } from '../core/reorder.js';

const EDGE = 64;   // 画面の端からこの近さで自動スクロール
const SPEED = 12;  // 1フレームあたりの px

// handle：つまみ、row：動く行、list：行の親。maxIndex：落とせる最後の場所。onDrop(from, to)：離したとき1回だけ呼ぶ。
export function attachDrag(handle, row, list, { from, maxIndex, onDrop }) {
  handle.addEventListener('pointerdown', (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    if (handle.disabled) return;
    const rows = [...list.children];
    const heights = rows.map((r) => r.offsetHeight);
    const scrollY0 = window.scrollY;
    const mids = rows.map((r) => r.getBoundingClientRect().top + scrollY0 + r.offsetHeight / 2);
    const startY = e.clientY;
    let lastY = e.clientY;
    let to = from;
    let raf = 0;
    const pid = e.pointerId;
    try { handle.setPointerCapture(pid); } catch { /* 取れなくても続ける */ }
    row.classList.add('dragging');
    list.classList.add('dragging-list');

    const update = () => {
      const dy = lastY - startY + (window.scrollY - scrollY0);
      row.style.transform = `translateY(${dy}px)`;
      to = Math.min(dropIndex(mids, from, mids[from] + dy), maxIndex);
      rows.forEach((r, j) => {
        if (j === from) return;
        let shift = 0;
        if (from < to && j > from && j <= to) shift = -heights[from];
        if (from > to && j >= to && j < from) shift = heights[from];
        r.style.transform = shift ? `translateY(${shift}px)` : '';
      });
    };
    const tick = () => {
      const h = window.innerHeight;
      if (lastY < EDGE) window.scrollBy(0, -SPEED);
      else if (lastY > h - EDGE) window.scrollBy(0, SPEED);
      update();
      raf = requestAnimationFrame(tick);
    };

    const onMove = (ev) => { if (ev.pointerId === pid) { lastY = ev.clientY; update(); } };
    const finish = (drop) => {
      cancelAnimationFrame(raf);
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
      handle.removeEventListener('pointercancel', onCancel);
      handle.removeEventListener('lostpointercapture', onCancel);
      try { handle.releasePointerCapture(pid); } catch { /* すでに離れている */ }
      row.classList.remove('dragging');
      list.classList.remove('dragging-list');
      rows.forEach((r) => { r.style.transform = ''; });
      if (drop && to !== from) onDrop(from, to);
    };
    const onUp = (ev) => { if (ev.pointerId === pid) finish(true); };
    const onCancel = (ev) => { if (ev.pointerId === pid) finish(false); };
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
    handle.addEventListener('pointercancel', onCancel);
    handle.addEventListener('lostpointercapture', onCancel);
    raf = requestAnimationFrame(tick);
  });
}
