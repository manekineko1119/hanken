import { el, setChildren, loadView } from '../ui/dom.js';
import { listPlaylists } from '../data/playlists.js';
import { runStart } from './prep-flow.js';
import { sortPlaylists, filterPlaylists, youtubeMusicUrl, normalizePref } from '../core/playlist-list.js';
import { formatDateJa } from '../core/lives.js';
import { playlistHref } from '../router.js';

const SORTS = [['newest', '新しい順'], ['oldest', '古い順'], ['live-date', 'ライブ順']];
const KINDS = [['all', 'すべて'], ['prep', '予習'], ['setlist', 'セトリ']];
const KEY = 'hanken.playlistView';

// 選んだ並び方・絞り込みを覚える（なくても動く）。
function loadPref() {
  try { return normalizePref(JSON.parse(localStorage.getItem(KEY) ?? 'null')); } catch { return normalizePref(null); }
}
function savePref(pref) {
  try { localStorage.setItem(KEY, JSON.stringify(pref)); } catch { /* 保存できなくてもよい */ }
}

function liveText(live) {
  if (!live) return 'ライブなし';
  return `${formatDateJa(live.date)}${live.venue ? `　${live.venue}` : ''}`;
}

function row(p, { selectedId, onListRowClick }) {
  const url = youtubeMusicUrl(p.youtubePlaylistId);
  const info = [
    el('span', { class: 'row-title', text: p.title }),
    el('span', { class: 'row-sub', text: p.artistName }),
    el('span', { class: 'row-sub', text: liveText(p.live) }),
  ];
  // 予習もセトリも、押すと編集の画面（セトリは曲名を押して直せる）を開く。
  return el('li', {},
    el('a', { class: 'row', href: playlistHref(p.id, { fromPrep: true }), 'aria-current': p.id === selectedId ? 'true' : null, onclick: onListRowClick }, ...info),
    p.status === 'saved'
      ? el('p', { class: 'row-status' },
        el('span', { class: 'status status-saved', text: '保存済み' }),
        url ? el('a', { href: url, target: '_blank', rel: 'noopener', text: 'YouTube Music で開く' }) : null)
      : el('p', { class: 'row-status' }, el('span', { class: 'status', text: 'まだ保存していません' })));
}

function select(label, options, value, onChange) {
  const s = el('select', { 'aria-label': label, class: 'filter-select' }, ...options.map(([k, t]) => el('option', { value: k, text: t })));
  s.value = value;
  s.addEventListener('change', () => onChange(s.value));
  return s;
}

export function renderPrep(container, ctx) {
  let updateRows;
  let requestId = 0;

  async function refresh() {
    const current = ++requestId;
    const alive = () => ctx.alive() && current === requestId;
    if (!updateRows) {
      await loadView(container, { alive }, listPlaylists, (items) => { updateRows = build(items); });
      return;
    }
    const next = await listPlaylists().catch(() => null);
    if (next && alive()) updateRows(next);
  }

  function build(items) {
    // プレイリストが1つもないときは条件の欄を出さないので、覚えていた条件も使わない。
    const pref = items.length ? loadPref() : normalizePref(null);
    const listBox = el('div', {});
    const drawList = () => {
      const shown = sortPlaylists(filterPlaylists(items, pref), pref.sort);
      setChildren(listBox,
        shown.length
          ? el('ul', { class: 'list' }, ...shown.map((p) => row(p, ctx)))
          : el('p', { class: 'note', text: pref.kind === 'setlist' && !items.some((p) => p.kind === 'setlist') ? 'セトリはまだありません' : items.length ? '条件に合うプレイリストがありません' : 'まだありません' }));
    };
    const change = (patch) => { Object.assign(pref, patch); savePref(pref); drawList(); };

    const search = el('input', { type: 'text', maxlength: '100', class: 'filter-search', placeholder: '探す', 'aria-label': 'アーティスト名・タイトルで絞る', value: pref.text });
    search.addEventListener('input', () => change({ text: search.value }));
    const filters = el('div', { class: 'filters', hidden: !items.length },
      search,
      select('並び順', SORTS, pref.sort, (v) => change({ sort: v })),
      select('種類', KINDS, pref.kind, (v) => change({ kind: v })));

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
      filters,
      listBox,
      el('h2', { text: 'アーティスト名から新しく作る' }),
      el('div', { class: 'field' }, el('label', { class: 'label', text: 'アーティスト名' }), input, go),
      msg);
    return (next) => {
      items = next;
      filters.hidden = !items.length;
      drawList();
    };
  }

  refresh();
  return refresh;
}
