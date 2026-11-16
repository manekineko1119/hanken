import { el, backLink, loadView, setChildren } from '../ui/dom.js';
import { getLive, saveLive } from '../data/lives.js';
import { validateLive } from '../core/live-form.js';

const SAVE_ERROR = '保存できませんでした。通信を確かめて、もう一度押してください';

// フォームの状態。artists の original は読み込んだときの名前（変えたら itunes_artist_id を外す）。
function initialState(live) {
  return {
    id: live?.id ?? null,
    date: live?.date ?? '',
    venue: live?.venue ?? '',
    title: live?.title ?? '',
    memo: live?.memo ?? '',
    artists: live?.artists?.length
      ? live.artists.map((a) => ({ id: a.id, name: a.name, original: a.name }))
      : [{ id: null, name: '', original: null }],
  };
}

function toPayload(state) {
  const orNull = (s) => (s.trim() === '' ? null : s.trim());
  const artists = state.artists.map((a) => {
    const out = { name: a.name };
    if (a.id) out.id = a.id;
    if (a.id && a.name.trim() !== a.original.trim()) out.itunes_artist_id = null;
    return out;
  });
  return { live: { id: state.id, date: state.date, venue: orNull(state.venue), title: orNull(state.title), memo: orNull(state.memo) }, artists };
}

// label の for と input の id でつなぐ（名前のない入力欄を作らない）。
function field(label, input, errorText) {
  const id = `f-${label}`;
  input.id = id;
  return el('div', { class: 'field' }, el('label', { for: id, class: 'label', text: label }), input, errorText ? el('p', { class: 'note error', role: 'alert', text: errorText }) : null);
}

function bind(input, state, key) {
  input.addEventListener('input', () => {
    state[key] = input.value;
  });
  return input;
}

function artistRow(state, index, rerender) {
  const a = state.artists[index];
  const name = el('input', { type: 'text', value: a.name, 'aria-label': `出演者 ${index + 1}`, autocomplete: 'off' });
  const warn = el('p', { class: 'note error artist-warn', text: '名前を空にすると、この出演者と予習の記録は保存のときに消えます', hidden: !(a.id && a.name.trim() === '') });
  name.addEventListener('input', () => {
    a.name = name.value;
    warn.hidden = !(a.id && a.name.trim() === '');
  });
  const move = (delta) => () => {
    const j = index + delta;
    [state.artists[index], state.artists[j]] = [state.artists[j], state.artists[index]];
    rerender();
  };
  const last = state.artists.length - 1;
  return el(
    'li',
    { class: 'artist-edit' },
    name,
    el('button', { type: 'button', 'aria-label': '上へ', disabled: index === 0, onclick: move(-1), text: '↑' }),
    el('button', { type: 'button', 'aria-label': '下へ', disabled: index === last, onclick: move(1), text: '↓' }),
    el('button', {
      type: 'button',
      'aria-label': '削除',
      text: '削除',
      onclick: () => {
        state.artists.splice(index, 1);
        rerender();
      },
    }),
    warn,
  );
}

function buildForm(container, state, isNew, alive) {
  let errors = {};
  let saveFailed = false;
  let saving = false;

  const draw = () => {
    const date = bind(el('input', { type: 'date', value: state.date, required: true }), state, 'date');
    const venue = bind(el('input', { type: 'text', value: state.venue, autocomplete: 'off' }), state, 'venue');
    const title = bind(el('input', { type: 'text', value: state.title, autocomplete: 'off' }), state, 'title');
    const memo = bind(el('textarea', { rows: '4' }), state, 'memo');
    memo.value = state.memo;

    const list = el('ul', { class: 'list' }, ...state.artists.map((_, i) => artistRow(state, i, draw)));
    const add = el('button', {
      type: 'button',
      text: '出演者を足す',
      onclick: () => {
        state.artists.push({ id: null, name: '', original: null });
        draw();
      },
    });
    const save = el('button', { type: 'submit', class: 'primary', text: saving ? '保存中…' : '保存', disabled: saving });
    const form = el(
      'form',
      { novalidate: true },
      field('日付', date, errors.date),
      field('会場', venue),
      field('タイトル', title),
      field('メモ', memo),
      el('div', { class: 'field' }, el('span', { class: 'label', text: '出演者' }), list, errors.artists ? el('p', { class: 'note error', role: 'alert', text: errors.artists }) : null, add),
      saveFailed ? el('p', { class: 'note error', role: 'alert', text: SAVE_ERROR }) : null,
      el('div', { class: 'actions' }, save),
    );
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      onSave();
    });
    setChildren(container,
      backLink(isNew ? '#/lives' : `#/live/${encodeURIComponent(state.id)}`, isNew ? '一覧へ' : '詳細へ'),
      el('h1', { text: isNew ? 'ライブを登録' : 'ライブを編集' }),
      form,
    );
  };

  async function onSave() {
    if (saving) return;
    const v = validateLive({ date: state.date, artists: state.artists });
    errors = v.errors;
    saveFailed = false;
    if (!v.ok) {
      draw();
      return;
    }
    saving = true;
    draw();
    const { live, artists } = toPayload(state);
    try {
      const id = await saveLive(live, artists);
      if (alive()) location.hash = `#/live/${encodeURIComponent(id)}`;
      return;
    } catch (err) {
      // 作成のあとで失敗したときは、次は同じライブを更新する（重複して作らない）。
      if (err?.liveId) state.id = err.liveId;
      saveFailed = true;
    }
    saving = false;
    if (alive()) draw();
  }

  draw();
}

export function renderLiveEdit(container, ctx) {
  const id = ctx.params.id;
  if (!id) {
    buildForm(container, initialState(null), true, ctx.alive);
    return;
  }
  loadView(container, ctx, () => getLive(id), (live) => {
    if (!live) {
      setChildren(container, backLink('#/lives', '一覧へ'), el('p', { class: 'note', text: 'このライブは見つかりませんでした' }));
      return;
    }
    buildForm(container, initialState(live), false, ctx.alive);
  });
}
