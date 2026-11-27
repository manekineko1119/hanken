import { el, backLink, loadView, setChildren, appendChildren } from '../ui/dom.js';
import { getLive, getPlaylistStatuses, deleteLive, updateLiveFields } from '../data/lives.js';
import { formatDateJa, liveHeading } from '../core/lives.js';
import { getPrepIds, getSetlistIds } from '../data/playlists.js';
import { runStart } from './prep-flow.js';
import { renderLivePhotos } from './live-photos.js';
import { getHomeStation } from '../data/settings.js';
import { sectionPatch } from '../core/live-form.js';
import { directionsUrl, nearbyUrl, lastTrainState } from '../core/live-links.js';

const STATUS_LABEL = { none: '未作成', draft: '下書き', saved: '保存済み' };
const DELETE_CONFIRM = 'このライブを消しますか？アプリの中の予習の記録と、写真も消えます。YouTube 上のプレイリストは消えません。';

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

const EMPTY = 'まだありません';

function extLink(href, label) {
  return el('a', { class: 'button', href, target: '_blank', rel: 'noopener', text: label });
}

// 見出しの右に「直す」。editor がなければ（ふだん）、その節の中身を出す。
function section(title, children, edit) {
  const body = children.filter(Boolean);
  const button = el('button', { type: 'button', class: 'live-record-edit', 'data-section': edit.key, 'aria-label': `${title}を直す`, text: '直す' });
  button.addEventListener('click', () => edit.open(edit.key));
  return el('section', { class: 'live-record' },
    el('div', { class: 'live-record-head' }, el('h2', { text: title }), button),
    ...(body.length ? body : [el('p', { class: 'note', text: EMPTY })]));
}

const SAVE_ERROR = '保存できませんでした。通信を確かめて、もう一度押してください';
// 節ごとの入力欄（ラベルは編集の画面と同じ）。
const FIELD_DEFS = {
  venue: { title: '会場', fields: [['venue_address', '住所', 'input'], ['venue_station', '会場の最寄り駅', 'input'], ['access_memo', '行き方のメモ', 'textarea']] },
  train: { title: '終電・打ち上げ', fields: [['last_train_memo', '終電のメモ', 'textarea'], ['afterparty_memo', '打ち上げ', 'textarea']] },
  impression: { title: '感想', fields: [['impression', '感想', 'textarea']] },
};

// 開いている節：入力欄と「保存」「キャンセル」。
function editSection(key, live, { onSaved, onCancel, onSaving, ctx }) {
  const def = FIELD_DEFS[key];
  const inputs = {};
  const rows = def.fields.map(([k, label, kind]) => {
    const id = `live-record-${key}-${k}`;
    const input = kind === 'textarea'
      ? el('textarea', { id, rows: k === 'impression' ? '4' : '3' })
      : el('input', { id, type: 'text', autocomplete: 'off' });
    input.value = text(live[k]);
    inputs[k] = input;
    return el('div', { class: 'field' }, el('label', { for: id, class: 'label', text: label }), input);
  });
  const save = el('button', { type: 'submit', class: 'primary', text: '保存' });
  const cancel = el('button', { type: 'button', text: 'キャンセル' });
  const err = el('p', { class: 'note error', role: 'alert', hidden: true, text: SAVE_ERROR });
  const form = el('form', { novalidate: true }, ...rows, err, el('div', { class: 'actions' }, save, cancel));
  cancel.addEventListener('click', () => { if (!save.disabled) onCancel(); });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (save.disabled) return;
    const values = Object.fromEntries(Object.entries(inputs).map(([k, i]) => [k, i.value]));
    const patch = sectionPatch(key, values);
    save.disabled = true;
    cancel.disabled = true;
    save.textContent = '保存中…';
    err.hidden = true;
    onSaving(true);
    try {
      await updateLiveFields(live.id, patch);
    } catch {
      onSaving(false);
      if (!ctx.alive()) return;
      save.disabled = false;
      cancel.disabled = false;
      save.textContent = '保存';
      err.hidden = false;
      return;
    }
    onSaving(false);
    if (!ctx.alive()) return;
    Object.assign(live, patch);
    onSaved();
  });
  return el('section', { class: 'live-record' }, el('div', { class: 'live-record-head' }, el('h2', { text: def.title })), form);
}

function memoP(label, value) {
  const v = text(value);
  if (!v) return null;
  return el('div', { class: 'live-record-block' },
    label ? el('p', { class: 'live-record-label', text: label }) : null,
    el('p', { class: 'live-record-text', text: v }));
}

function venueSection(live, edit) {
  const dir = directionsUrl(live);
  const near = nearbyUrl(live);
  const station = text(live.venue_station);
  return section('会場', [
    text(live.venue) ? el('p', { class: 'live-record-text', text: text(live.venue) }) : null,
    text(live.venue_address) ? el('p', { class: 'live-record-text', text: text(live.venue_address) }) : null,
    station ? el('p', { class: 'live-record-text', text: `最寄り駅：${station}` }) : null,
    dir || near ? el('div', { class: 'live-record-links' }, dir ? extLink(dir, '行き方') : null, near ? extLink(near, '周りの店') : null) : null,
    memoP('行き方のメモ', live.access_memo),
  ], edit);
}

function trainSection(live, home, edit) {
  const st = lastTrainState(live, home);
  let link;
  if (st.url) {
    link = el('div', { class: 'live-record-links' }, extLink(st.url, '終電を調べる'));
  } else if (st.needVenueStation || st.needHome) {
    const editLink = st.needVenueStation ? el('a', { href: `#/live/${encodeURIComponent(live.id)}/edit`, text: '編集' }) : el('span', { text: '編集' });
    const settings = st.needHome ? el('a', { href: '#/settings', text: '設定' }) : el('span', { text: '設定' });
    link = el('p', { class: 'note live-record-hint' },
      el('span', { text: '会場の最寄り駅（' }), editLink, el('span', { text: '）と自分の最寄り駅（' }), settings, el('span', { text: '）を入れると、終電を調べられます' }));
  }
  return section('終電・打ち上げ', [
    link,
    memoP('終電のメモ', live.last_train_memo),
    memoP('打ち上げ', live.afterparty_memo),
  ], edit);
}

function impressionSection(live, edit) {
  return section('感想', [memoP(null, live.impression)], edit);
}

export function renderLiveDetail(container, ctx) {
  const id = ctx.params.id;
  loadView(
    container,
    ctx,
    async () => {
      // 自分の最寄り駅が読めなくても画面は出す（終電のところでヒントを出す）。
      const [live, statuses, prepIds, setlistIds, home] = await Promise.all([
        getLive(id), getPlaylistStatuses(id), getPrepIds(id), getSetlistIds(id), getHomeStation().catch(() => null),
      ]);
      return { live, statuses, prepIds, setlistIds, home };
    },
    ({ live, statuses, prepIds, setlistIds, home }) => {
      if (!live) {
        setChildren(container, backLink('#/lives', '一覧へ'), el('p', { class: 'note', text: 'このライブは見つかりませんでした' }));
        return;
      }
      const msg = el('p', { class: 'note error', role: 'alert', hidden: true });
      const del = el('button', { type: 'button', class: 'danger', text: '削除' });
      del.addEventListener('click', () => onDelete(live, container, del, ctx));
      // ③④⑤：開いている節は1つだけ。開く・保存・キャンセルで ③④⑤ をまとめて描き直す（終電のリンクは会場の駅を使うため）。
      const records = el('div', { class: 'live-records' });
      let openKey = null;
      let saving = false;
      const drawRecords = (focusKey = null) => {
        const open = (key) => { if (saving) return; openKey = key; drawRecords(); records.querySelector('textarea, input')?.focus(); };
        const close = (key) => { if (openKey !== key) return; openKey = null; drawRecords(key); };
        const onSaving = (v) => { saving = v; for (const b of records.querySelectorAll('.live-record-edit')) b.disabled = v; };
        const part = (key, build) => (openKey === key
          ? editSection(key, live, { ctx, onSaving, onSaved: () => close(key), onCancel: () => close(key) })
          : build({ key, open }));
        setChildren(records,
          part('venue', (edit) => venueSection(live, edit)),
          part('train', (edit) => trainSection(live, home, edit)),
          part('impression', (edit) => impressionSection(live, edit)));
        if (focusKey) records.querySelector(`[data-section="${focusKey}"]`)?.focus();
      };
      drawRecords();
      setChildren(container,
        backLink('#/lives', '一覧へ'),
        el('h1', { text: liveHeading(live) }),
        el('p', { class: 'meta', text: formatDateJa(live.date) + (text(live.venue) ? `　${text(live.venue)}` : '') }),
        text(live.memo) ? el('p', { class: 'memo', text: live.memo }) : null,
        el('h2', { text: '出演者' }),
        el('ul', { class: 'list on-paper' }, ...live.artists.map((a, i) => artistRow(a, i, { live, statuses, prepIds, setlistIds, ctx, msg }))),
        msg,
        records,
        renderLivePhotos(live.id, ctx),
        el('div', { class: 'actions' }, el('a', { class: 'button', href: `#/live/${encodeURIComponent(live.id)}/edit`, text: '編集' }), del),
      );
    },
  );
}
