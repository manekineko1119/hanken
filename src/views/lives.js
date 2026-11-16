import { el, loadView } from '../ui/dom.js';
import { listLives } from '../data/lives.js';
import { splitLives, todayJst, formatDateJa } from '../core/lives.js';

function row(live) {
  const title = live.title || live.artists.map((a) => a.name).join('、') || '（無題）';
  return el(
    'li',
    {},
    el(
      'a',
      { class: 'row', href: `#/live/${encodeURIComponent(live.id)}` },
      el('span', { class: 'row-date', text: formatDateJa(live.date) }),
      el('span', { class: 'row-title', text: title }),
      live.venue ? el('span', { class: 'row-sub', text: live.venue }) : null,
    ),
  );
}

function section(heading, lives) {
  return el(
    'section',
    {},
    el('h2', { text: heading }),
    lives.length ? el('ul', { class: 'list' }, ...lives.map(row)) : el('p', { class: 'note', text: 'まだありません' }),
  );
}

export function renderLives(container, ctx) {
  loadView(container, ctx, listLives, (lives) => {
    const { upcoming, past } = splitLives(lives, todayJst(new Date()));
    container.replaceChildren(
      el('div', { class: 'page-head' }, el('h1', { text: 'ライブ' }), el('a', { class: 'button primary', href: '#/live/new', text: 'ライブを登録' })),
      section('これから', upcoming),
      section('行った', past),
    );
  });
}
