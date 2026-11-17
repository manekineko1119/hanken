import { el, setChildren, loadView } from '../ui/dom.js';
import { listPlaylists } from '../data/playlists.js';
import { runStart } from './prep-flow.js';
import { sortPlaylists, filterPlaylists, youtubeMusicUrl } from '../core/playlist-list.js';
import { formatDateJa } from '../core/lives.js';

const SORTS = [['newest', '作った順（新しい順）'], ['oldest', '古い順'], ['live-date', 'ライブの日付順']];
const STATUSES = [['all', 'すべて'], ['saved', '保存済み'], ['draft', 'まだ保存していない']];
const KEY = 'hanken.playlistView';

// 選んだ並び方・絞り込みを覚える（なくても動く）。
function loadPref() {
  const pref = { sort: 'newest', status: 'all', text: '' };
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (v && SORTS.some(([k]) => k === v.sort)) pref.sort = v.sort;
    if (v && STATUSES.some(([k]) => k === v.status)) pref.status = v.status;
    if (v && typeof v.text === 'string') pref.text = v.text.slice(0, 100);
  } catch { /* 読めなければ既定のまま */ }
  return pref;
}
function savePref(pref) {
  try { localStorage.setItem(KEY, JSON.stringify(pref)); } catch { /* 保存できなくてもよい */ }
}

function liveText(live) {
  if (!live) return 'ライブなし';
  return `${formatDateJa(live.date)}${live.venue ? `　${live.venue}` : ''}`;
}

function row(p) {
  const url = youtubeMusicUrl(p.youtubePlaylistId);
  return el('li', {},
    el('a', { class: 'row', href: `#/playlist/${encodeURIComponent(p.id)}` },
      el('span', { class: 'row-title', text: p.title }),
      el('span', { class: 'row-sub', text: p.artistName }),
      el('span', { class: 'row-sub', text: liveText(p.live) })),
    p.status === 'saved'
      ? el('p', { class: 'row-status' },
        el('span', { class: 'status status-saved', text: '保存済み' }),
        url ? el('a', { href: url, target: '_blank', rel: 'noopener', text: 'YouTube Music で開く' }) : null)
      : el('p', { class: 'row-status' }, el('span', { class: 'status', text: 'まだ保存していません' })));
}

function select(label, options, value, onChange) {
  const s = el('select', { 'aria-label': label }, ...options.map(([k, t]) => el('option', { value: k, text: t })));
  s.value = value;
  s.addEventListener('change', () => onChange(s.value));
  return el('label', { class: 'control' }, el('span', { class: 'label', text: label }), s);
}

export function renderPrep(container, ctx) {
  loadView(container, ctx, listPlaylists, (items) => {
    const pref = loadPref();
    const listBox = el('div', {});
    const drawList = () => {
      const shown = sortPlaylists(filterPlaylists(items, pref), pref.sort);
      setChildren(listBox,
        shown.length
          ? el('ul', { class: 'list' }, ...shown.map(row))
          : el('p', { class: 'note', text: items.length ? '条件に合うプレイリストがありません' : 'まだありません' }));
    };
    const change = (patch) => { Object.assign(pref, patch); savePref(pref); drawList(); };

    const search = el('input', { type: 'text', maxlength: '100', placeholder: 'アーティスト名・タイトルで絞る', 'aria-label': 'アーティスト名・タイトルで絞る', value: pref.text });
    search.addEventListener('input', () => change({ text: search.value }));

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
    drawList();
    setChildren(container,
      el('h1', { text: 'プレイリスト' }),
      items.length
        ? el('div', { class: 'filters' },
          select('並び順', SORTS, pref.sort, (v) => change({ sort: v })),
          select('状態', STATUSES, pref.status, (v) => change({ status: v })),
          el('label', { class: 'control' }, el('span', { class: 'label', text: '探す' }), search))
        : null,
      listBox,
      el('h2', { text: 'アーティスト名から新しく作る' }),
      el('div', { class: 'field' }, el('label', { class: 'label', text: 'アーティスト名' }), input, go),
      msg);
  });
}
