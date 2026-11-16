import { el, setChildren, loadView } from '../ui/dom.js';
import { listPrepOnly } from '../data/playlists.js';
import { runStart } from './prep-flow.js';

export function renderPrep(container, ctx) {
  loadView(container, ctx, listPrepOnly, (items) => {
    const input = el('input', { type: 'text', maxlength: '100', placeholder: 'アーティスト名', 'aria-label': 'アーティスト名' });
    const msg = el('p', { class: 'note error', role: 'alert', hidden: true });
    const go = el('button', { type: 'button', class: 'primary', text: 'アーティスト名から作る' });
    go.addEventListener('click', () => {
      const name = input.value.trim();
      if (!name) {
        msg.textContent = 'アーティスト名を入れてください';
        msg.hidden = false;
        return;
      }
      runStart({ name }, ctx, { button: go, msg });
    });
    setChildren(container,
      el('h1', { text: '予習だけ' }),
      items.length
        ? el('ul', { class: 'list' }, ...items.map((p) => el('li', {},
          el('a', { class: 'row', href: `#/playlist/${encodeURIComponent(p.id)}` },
            el('span', { class: 'row-title', text: p.title }),
            el('span', { class: 'row-sub', text: `${p.count}曲` })))))
        : el('p', { class: 'note', text: 'まだありません' }),
      el('div', { class: 'field' }, el('label', { class: 'label', text: 'アーティスト名' }), input, go),
      msg);
  });
}
