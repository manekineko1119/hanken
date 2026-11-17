import { el, setChildren, backLink } from '../ui/dom.js';
import { loadContext, createFor, orderedCandidates, NOT_FOUND } from './prep-flow.js';
import { playlistHref } from '../router.js';

export async function renderArtistPick(container, ctx) {
  const c = loadContext();
  if (!c) {
    setChildren(container, backLink('#/lives', 'ライブの一覧へ'), el('p', { class: 'note', text: '作る操作からやり直してください' }));
    return;
  }
  const back = c.liveId ? `#/live/${encodeURIComponent(c.liveId)}` : '#/prep';
  const head = [backLink(back, '戻る'), el('h1', { text: `「${c.name}」はどのアーティスト？` })];
  setChildren(container, ...head, el('p', { class: 'note', text: '探しています…' }));

  let candidates;
  let failure = null;
  try {
    candidates = await orderedCandidates(c.name);
  } catch (err) {
    failure = err.message;
  }
  if (!ctx.alive()) return;
  if (failure || !candidates.length) {
    setChildren(container, ...head, el('p', { class: 'note error', role: 'alert', text: failure ?? NOT_FOUND }));
    return;
  }

  const msg = el('p', { class: 'note error', role: 'alert', hidden: true });
  const buttons = candidates.map((cand) => {
    const b = el('button', { type: 'button', text: cand.genre ? `${cand.name}（${cand.genre}）` : cand.name });
    b.addEventListener('click', async () => {
      buttons.forEach((x) => { x.disabled = true; });
      msg.hidden = true;
      try {
        const id = await createFor(c, cand.id);
        if (ctx.alive()) location.hash = playlistHref(id, { fromPrep: !c.liveId });
      } catch (err) {
        if (!ctx.alive()) return;
        msg.textContent = err.message;
        msg.hidden = false;
        buttons.forEach((x) => { x.disabled = false; });
      }
    });
    return b;
  });
  setChildren(container, ...head,
    el('ul', { class: 'list' }, ...buttons.map((b) => el('li', {}, b))),
    msg,
    el('a', { class: 'button', href: back, text: '見つからない' }));
}
