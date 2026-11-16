import { el, backLink, loadView } from '../ui/dom.js';
import { getLive, getPlaylistStatuses, deleteLive } from '../data/lives.js';
import { formatDateJa } from '../core/lives.js';

const STATUS_LABEL = { none: '未作成', draft: '下書き', saved: '保存済み' };
const DELETE_CONFIRM = 'このライブを消しますか？アプリの中の予習の記録も消えます。YouTube 上のプレイリストは消えません。';

function artistRow(artist, index, statuses) {
  const prep = statuses.get(artist.id)?.prep ?? 'none';
  return el(
    'li',
    { class: 'artist-row' },
    el('span', { class: 'artist-name', text: `${index + 1}. ${artist.name}` }),
    el('span', { class: `status status-${prep}`, text: `予習：${STATUS_LABEL[prep]}` }),
    // 予習の作成は Task 9 で作る。
    el('button', { type: 'button', disabled: true, text: '準備中' }),
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
    container.append(el('p', { class: 'note error delete-error', role: 'alert', text: '消せませんでした。通信を確かめて、もう一度押してください' }));
  }
}

export function renderLiveDetail(container, ctx) {
  const id = ctx.params.id;
  loadView(
    container,
    ctx,
    async () => {
      const [live, statuses] = await Promise.all([getLive(id), getPlaylistStatuses(id)]);
      return { live, statuses };
    },
    ({ live, statuses }) => {
      if (!live) {
        container.replaceChildren(backLink('#/lives', '一覧へ'), el('p', { class: 'note', text: 'このライブは見つかりませんでした' }));
        return;
      }
      const del = el('button', { type: 'button', class: 'danger', text: '削除' });
      del.addEventListener('click', () => onDelete(live, container, del, ctx));
      container.replaceChildren(
        backLink('#/lives', '一覧へ'),
        el('h1', { text: live.title || formatDateJa(live.date) }),
        el('p', { class: 'meta', text: formatDateJa(live.date) + (live.venue ? `　${live.venue}` : '') }),
        live.memo ? el('p', { class: 'memo', text: live.memo }) : null,
        el('h2', { text: '出演者' }),
        el('ul', { class: 'list' }, ...live.artists.map((a, i) => artistRow(a, i, statuses))),
        el('div', { class: 'actions' }, el('a', { class: 'button', href: `#/live/${encodeURIComponent(live.id)}/edit`, text: '編集' }), del),
      );
    },
  );
}
