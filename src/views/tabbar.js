import { el, appendChildren } from '../ui/dom.js';

const TABS = [
  { href: '#/lives', label: 'ライブ', paths: ['/lives', '/live/new', '/live/:id', '/live/:id/edit'] },
  { href: '#/prep', label: 'プレイリスト', paths: ['/prep', '/playlist/:id'] },
  { href: '#/settings', label: '設定', paths: ['/settings'] },
];

// nav に下のタブを出す。ログインしていないときは隠す。
export function renderTabbar(nav, { visible, path }) {
  nav.replaceChildren();
  nav.hidden = !visible;
  if (!visible) return;
  for (const t of TABS) {
    const current = t.paths.includes(path);
    appendChildren(nav, el('a', { href: t.href, text: t.label, 'aria-current': current ? 'page' : null }));
  }
}
