import { el, backLink, loadView, setChildren } from '../ui/dom.js';
import { getLive, saveLive, listLives } from '../data/lives.js';
import { validateLive, newArtist, deletableIds, venueSuggestions, copyFromPastVenue } from '../core/live-form.js';

const SAVE_ERROR = '保存できませんでした。通信を確かめて、もう一度押してください';

// フォームの状態。artists の original は読み込んだときの名前（変えたら itunes_artist_id を外す）。
function initialState(live) {
  const state = {
    id: live?.id ?? null,
    // 開いたときに読んだ出演者の id（新しいライブは null：作ったあとの再試行では、今までどおり差分で消す）
    loadedIds: live ? (live.artists ?? []).map((a) => a.id) : null,
    date: live?.date ?? '',
    venue: live?.venue ?? '',
    title: live?.title ?? '',
    memo: live?.memo ?? '',
    venue_address: live?.venue_address ?? '',
    venue_station: live?.venue_station ?? '',
    access_memo: live?.access_memo ?? '',
    last_train_memo: live?.last_train_memo ?? '',
    afterparty_memo: live?.afterparty_memo ?? '',
    impression: live?.impression ?? '',
    artists: [],
  };
  state.artists = live?.artists?.length
    ? live.artists.map((a) => ({ id: a.id, name: a.name, original: a.name }))
    : [newArtist(state)];
  return state;
}

function toPayload(state) {
  const orNull = (s) => (s.trim() === '' ? null : s.trim());
  const artists = state.artists.map((a) => {
    const out = { name: a.name };
    if (a.id) out.id = a.id;
    if (a.id && a.original != null && a.name.trim() !== a.original.trim()) out.itunes_artist_id = null;
    return out;
  });
  return {
    live: {
      id: state.id, date: state.date, venue: orNull(state.venue), title: orNull(state.title), memo: orNull(state.memo),
      venue_address: orNull(state.venue_address),
      venue_station: orNull(state.venue_station),
      access_memo: orNull(state.access_memo),
      last_train_memo: orNull(state.last_train_memo),
      afterparty_memo: orNull(state.afterparty_memo),
      impression: orNull(state.impression),
    },
    artists,
  };
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

function textarea(state, key, rows = '3') {
  const t = bind(el('textarea', { rows }), state, key);
  t.value = state[key];
  return t;
}

function buildForm(container, state, isNew, alive, initialLives = []) {
  let pastLives = initialLives;
  let copyText = ''; // 「写しました」の表示。draw し直しても残す
  let errors = {};
  let saveFailed = false;
  let saving = false;

  const draw = () => {
    const date = bind(el('input', { type: 'date', value: state.date, required: true }), state, 'date');
    const venue = bind(el('input', { type: 'text', value: state.venue, autocomplete: 'off', list: 'venue-options' }), state, 'venue');
    const options = el('datalist', { id: 'venue-options' }, ...venueSuggestions(pastLives, state.id).map((v) => el('option', { value: v })));
    const address = bind(el('input', { type: 'text', value: state.venue_address, autocomplete: 'off' }), state, 'venue_address');
    const station = bind(el('input', { type: 'text', value: state.venue_station, autocomplete: 'off' }), state, 'venue_station');
    const access = textarea(state, 'access_memo');
    const lastTrain = textarea(state, 'last_train_memo');
    const afterparty = textarea(state, 'afterparty_memo');
    const impression = textarea(state, 'impression', '4');
    const copyNote = el('p', { class: 'note', role: 'status', hidden: !copyText, text: copyText });
    const copyInputs = { venue_address: address, venue_station: station, access_memo: access, last_train_memo: lastTrain };
    venue.addEventListener('change', () => {
      const copied = copyFromPastVenue(state, pastLives, venue.value);
      for (const key of copied) copyInputs[key].value = state[key];
      copyText = copied.length ? `前の${venue.value.trim()}のライブから写しました` : '';
      copyNote.hidden = !copyText;
      copyNote.textContent = copyText;
    });
    const title = bind(el('input', { type: 'text', value: state.title, autocomplete: 'off' }), state, 'title');
    const memo = bind(el('textarea', { rows: '4' }), state, 'memo');
    memo.value = state.memo;

    const list = el('ul', { class: 'list' }, ...state.artists.map((_, i) => artistRow(state, i, draw)));
    const add = el('button', {
      type: 'button',
      text: '出演者を足す',
      onclick: () => {
        state.artists.push(newArtist(state));
        draw();
      },
    });
    const save = el('button', { type: 'submit', class: 'primary', text: saving ? '保存中…' : '保存', disabled: saving });
    const form = el(
      'form',
      { novalidate: true },
      field('日付', date, errors.date),
      field('会場', venue),
      options,
      copyNote,
      field('住所', address),
      field('会場の最寄り駅', station),
      field('行き方のメモ', access),
      field('タイトル', title),
      field('メモ', memo),
      el('div', { class: 'field' }, el('span', { class: 'label', text: '出演者' }), list, errors.artists ? el('p', { class: 'note error', role: 'alert', text: errors.artists }) : null, add),
      field('終電のメモ', lastTrain),
      field('打ち上げ', afterparty),
      field('感想', impression),
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
      const id = await saveLive(live, artists, deletableIds(state));
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
  // 会場名の候補があとから届いたとき、いまの datalist だけ入れ替える（入力中の欄に触らない）
  return {
    setPastLives(lives) {
      pastLives = lives;
      const dl = container.querySelector('#venue-options');
      if (dl) dl.replaceChildren(...venueSuggestions(pastLives, state.id).map((v) => el('option', { value: v })));
    },
  };
}

export function renderLiveEdit(container, ctx) {
  const id = ctx.params.id;
  if (!id) {
    // フォームはすぐ出す。会場名の候補は届いたら足す（読めなくてもフォームは使える）
    const form = buildForm(container, initialState(null), true, ctx.alive);
    listLives().then((lives) => ctx.alive() && form.setPastLives(lives), () => {});
    return;
  }
  loadView(container, ctx, async () => {
    const [live, lives] = await Promise.all([getLive(id), listLives().catch(() => [])]);
    return { live, lives };
  }, ({ live, lives }) => {
    if (!live) {
      setChildren(container, backLink('#/lives', '一覧へ'), el('p', { class: 'note', text: 'このライブは見つかりませんでした' }));
      return;
    }
    buildForm(container, initialState(live), false, ctx.alive, lives);
  });
}
