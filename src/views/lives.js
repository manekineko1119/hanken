import { el, loadView, setChildren } from '../ui/dom.js';
import { listLives } from '../data/lives.js';
import { splitLives, todayJst, formatDateJa, liveHeading } from '../core/lives.js';

function row(live) {
  const title = liveHeading(live);
  return el(
    'li',
    {},
    el(
      'a',
      { class: 'row', href: `#/live/${encodeURIComponent(live.id)}` },
      el('span', { class: 'row-date', text: formatDateJa(live.date) }),
      el('span', { class: 'row-title', text: title }),
      typeof live.venue === 'string' && live.venue.trim() ? el('span', { class: 'row-sub', text: live.venue }) : null,
    ),
  );
}

// kind: 'upcoming'（半券の付いた券）か 'past'（半券を切り取ったあとの券）。見た目は app.css の .tickets-*。
function section(heading, lives, kind) {
  return el(
    'section',
    {},
    el('h2', { text: heading }),
    lives.length ? el('ul', { class: `list tickets tickets-${kind}` }, ...lives.map(row)) : el('p', { class: 'note', text: 'まだありません' }),
  );
}

export function renderLives(container, ctx) {
  loadView(container, ctx, listLives, (lives) => {
    const { upcoming, past } = splitLives(lives, todayJst(new Date()));
    setChildren(container,
      el('div', { class: 'page-head' }, el('h1', { text: 'ライブ' }), el('a', { class: 'button primary', href: '#/live/new', text: 'ライブを登録' })),
      section('これから', upcoming, 'upcoming'),
      section('行った', past, 'past'),
    );
  });
}
