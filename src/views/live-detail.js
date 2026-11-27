import { el, backLink, loadView, setChildren, appendChildren } from '../ui/dom.js';
import { getLive, getPlaylistStatuses, deleteLive } from '../data/lives.js';
import { formatDateJa, liveHeading } from '../core/lives.js';
import { getPrepIds, getSetlistIds } from '../data/playlists.js';
import { runStart } from './prep-flow.js';

const STATUS_LABEL = { none: '未作成', draft: '下書き', saved: '保存済み' };
const DELETE_CONFIRM = 'このライブを消しますか？アプリの中の予習の記録も消えます。YouTube 上のプレイリストは消えません。';

// null・undefined・空白だけは空にする（「null」を画面に出さない）。
function text(v) {
  return typeof v === 'string' ? v.trim() : '';
}

function artistRow(artist, index, { live, statuses, prepIds, setlistIds, ctx, msg }) {
  const prep = statuses.get(artist.id)?.prep ?? 'none';
  const prepId = prepIds.get(artist.id);
  const action = prepId
    ? el('a', { class: 'button', href: `#/playlist/${encodeURIComponent(prepId)}`, text: '開く' })
    : el('button', { type: 'button', text: '作る' });
  if (!prepId) {
    action.addEventListener('click', () => runStart(
      { name: artist.name, liveId: live.id, liveArtistId: artist.id, date: live.date, venue: text(live.venue) || undefined },
      ctx, { button: action, msg },
    ));
  }
  // セトリ（フェーズ2）：なければ読み取りの画面へ、あれば編集の画面へ。
  const setlist = statuses.get(artist.id)?.setlist ?? 'none';
  const setlistId = setlistIds.get(artist.id);
  const setlistHref = setlistId
    ? `#/playlist/${encodeURIComponent(setlistId)}`
    : `#/live/${encodeURIComponent(live.id)}/setlist/${encodeURIComponent(artist.id)}`;
  return el(
    'li',
    { class: 'artist-row live-artist' },
    el('span', { class: 'artist-name', text: `${index + 1}. ${artist.name}` }),
    el('span', { class: `status status-${prep}`, text: `予習：${STATUS_LABEL[prep]}` }),
    action,
    el(
      'div',
      { class: 'setlist-line' },
      el('span', { class: `status status-${setlist}`, text: `セトリ：${STATUS_LABEL[setlist]}` }),
      el('a', { class: 'button', href: setlistHref, text: setlistId ? '開く' : '作る' }),
    ),
  );
}

async function onDelete(live, container, button, ctx) {
  if (!confirm(DELETE_CONFIRM)) return;
  button.disabled = true;
  try {
    await deleteLive(live.id);
    if (ctx.alive()) location.hash = '#/lives';
  } catch {
    if (!ctx.alive()) return;
    button.disabled = false;
    container.querySelector('.delete-error')?.remove();
    appendChildren(container, el('p', { class: 'note error delete-error', role: 'alert', text: '消せませんでした。通信を確かめて、もう一度押してください' }));
  }
}

export function renderLiveDetail(container, ctx) {
  const id = ctx.params.id;
  loadView(
    container,
    ctx,
    async () => {
      const [live, statuses, prepIds, setlistIds] = await Promise.all([getLive(id), getPlaylistStatuses(id), getPrepIds(id), getSetlistIds(id)]);
      return { live, statuses, prepIds, setlistIds };
    },
    ({ live, statuses, prepIds, setlistIds }) => {
      if (!live) {
        setChildren(container, backLink('#/lives', '一覧へ'), el('p', { class: 'note', text: 'このライブは見つかりませんでした' }));
        return;
      }
      const msg = el('p', { class: 'note error', role: 'alert', hidden: true });
      const del = el('button', { type: 'button', class: 'danger', text: '削除' });
      del.addEventListener('click', () => onDelete(live, container, del, ctx));
      setChildren(container,
        backLink('#/lives', '一覧へ'),
        el('h1', { text: liveHeading(live) }),
        el('p', { class: 'meta', text: formatDateJa(live.date) + (text(live.venue) ? `　${text(live.venue)}` : '') }),
        text(live.memo) ? el('p', { class: 'memo', text: live.memo }) : null,
        el('h2', { text: '出演者' }),
        el('ul', { class: 'list on-paper' }, ...live.artists.map((a, i) => artistRow(a, i, { live, statuses, prepIds, setlistIds, ctx, msg }))),
        msg,
        el('div', { class: 'actions' }, el('a', { class: 'button', href: `#/live/${encodeURIComponent(live.id)}/edit`, text: '編集' }), del),
      );
    },
  );
}
