import { el, loadView, setChildren } from '../ui/dom.js';
import { listLives } from '../data/lives.js';
import { splitLives, todayJst, formatDateJa } from '../core/lives.js';

function row(live, { selectedId, onListRowClick }) {
  const title = typeof live.title === 'string' ? live.title.trim() : '';
  const venue = typeof live.venue === 'string' ? live.venue.trim() : '';
  return el(
    'li',
    {},
    el(
      'a',
      { class: 'row', href: `#/live/${encodeURIComponent(live.id)}`, 'aria-current': live.id === selectedId ? 'true' : null, onclick: onListRowClick },
      el('span', { class: 'row-date', text: formatDateJa(live.date) }),
      el('span', { class: 'row-title', text: title || 'タイトル未設定' }),
      el('span', { class: 'row-sub', text: venue }),
    ),
  );
}

// kind: 'upcoming'（半券の付いた券）か 'past'（半券を切り取ったあとの券）。見た目は app.css の .tickets-*。
function section(heading, lives, kind, ctx) {
  return el(
    'section',
    {},
    el('h2', { text: heading }),
    lives.length ? el('ul', { class: `list tickets tickets-${kind}` }, ...lives.map((live) => row(live, ctx))) : el('p', { class: 'note', text: 'まだありません' }),
  );
}

export function renderLives(container, ctx) {
  loadView(container, ctx, listLives, (lives) => {
    const { upcoming, past } = splitLives(lives, todayJst(new Date()));
    setChildren(container,
      el('div', { class: 'page-head' }, el('h1', { text: 'ライブ' }), el('a', { class: 'button primary', href: '#/live/new', text: 'ライブを登録' })),
      section('これから', upcoming, 'upcoming', ctx),
      section('行った', past, 'past', ctx),
    );
  });
}
