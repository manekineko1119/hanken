import { el, setChildren, loadView } from '../ui/dom.js';
import { signOut } from '../auth/auth.js';
import { getStatus, connect, disconnect, finishConnect } from '../data/youtube.js';
import { stationFieldState } from '../core/settings.js';
import { getHomeStation, saveHomeStation } from '../data/settings.js';
import { daysLeft, pendingIdOf, finishErrorText } from '../core/youtube.js';

export { daysLeft };

const NOTICES = {
  error: 'YouTube につなげませんでした。もう一度試してください',
  noscope: 'YouTube の権限にチェックが入っていませんでした。許可の画面で YouTube の項目にチェックを入れて、もう一度つないでください',
};
const RETURN_TO = '#/settings';

function showError(msg, text) {
  msg.textContent = text;
  msg.hidden = false;
}

export function renderSettings(container, ctx) {
  const view = el('div', { class: 'settings-view' });
  setChildren(container, view);
  // Google から戻ったところ：ログイン中のこの人のつながりとして確定してから、元の画面へ戻る。
  const pendingId = pendingIdOf(ctx.query);
  if (pendingId) {
    setChildren(view, el('h1', { text: '設定' }), el('p', { class: 'note', role: 'status', text: 'YouTube とつないでいます…' }));
    (async () => {
      let done = null;
      let code;
      try { done = await finishConnect(pendingId); } catch (e) { code = e?.code; }
      if (!ctx.alive()) return;
      // 戻る・進むで保留の id を使い直さないよう、履歴を置き換える。
      if (done) { location.replace(done.returnTo || '#/settings'); return; }
      renderSettings(container, { ...ctx, query: {}, finishError: finishErrorText(code) });
    })();
    return;
  }
  loadView(view, ctx, async () => ({ status: await getStatus(), home: await getHomeStation().catch(() => undefined) }), ({ status, home }) => {
    const msg = el('p', { class: 'note error', role: 'alert', hidden: true });
    const notice = ctx.finishError ?? NOTICES[ctx.query?.yt];
    if (notice) showError(msg, notice);

    const yt = el('section', { class: 'settings-section' });
    const ytHeading = el('h2', { text: 'YouTube' });
    if (status.connected) {
      const left = status.connectedAt ? daysLeft(status.connectedAt, new Date()) : 0;
      const off = el('button', { type: 'button', class: 'danger', text: '切断' });
      off.addEventListener('click', async () => {
        off.disabled = true;
        msg.hidden = true;
        try {
          await disconnect();
        } catch {
          if (ctx.alive()) {
            off.disabled = false;
            showError(msg, '切断できませんでした。通信を確かめて、もう一度押してください');
          }
          return;
        }
        if (ctx.alive()) renderSettings(container, { ...ctx, query: {} });
      });
      setChildren(yt,
        ytHeading,
        el('p', { text: `つながっています：${status.channelTitle || 'チャンネル名なし'}` }),
        el('p', { class: 'note', text: left > 0 ? `あと約${left}日で切れます` : '期限が切れています。つなぎ直してください' }),
        el('div', { class: 'settings-actions' }, left > 0 ? null : connectButton(msg, ctx), off),
      );
    } else {
      setChildren(yt, ytHeading, el('p', { text: 'つながっていません' }),
        el('div', { class: 'settings-actions' }, connectButton(msg, ctx)));
    }

    const stationInput = el('input', { type: 'text', id: 'home-station', placeholder: '例：○○駅', autocomplete: 'off' });
    const stationState = stationFieldState(home);
    stationInput.value = stationState.value;
    const stationMsg = el('p', { class: 'note', role: 'status', hidden: true });
    const stationSave = el('button', { type: 'button', text: '保存' });
    stationSave.addEventListener('click', async () => {
      stationSave.disabled = true;
      stationMsg.hidden = true;
      stationMsg.classList.remove('error');
      let ok = true;
      try {
        await saveHomeStation(stationInput.value);
      } catch {
        ok = false;
      }
      if (!ctx.alive()) return;
      stationSave.disabled = false;
      stationMsg.classList.toggle('error', !ok);
      stationMsg.setAttribute('role', ok ? 'status' : 'alert');
      stationMsg.textContent = ok ? '保存しました' : '保存できませんでした。通信を確かめて、もう一度押してください';
      stationMsg.hidden = false;
    });
    const station = el('section', { class: 'settings-section' },
      el('h2', { text: '最寄り駅' }),
      ...(stationState.editable ? [
        el('label', { for: 'home-station', text: '自分の最寄り駅' }),
        stationInput,
        el('p', { class: 'note', text: '終電を調べるときに、帰りの駅として使います' }),
        el('div', { class: 'settings-actions' }, stationSave),
        stationMsg,
      ] : [
        el('p', { class: 'note error', role: 'alert', text: '最寄り駅を読み込めませんでした。開き直してください' }),
      ]));

    const out = el('button', { type: 'button', text: 'ログアウト' });
    out.addEventListener('click', async () => {
      out.disabled = true;
      msg.hidden = true;
      let ok = false;
      try {
        ({ ok } = await signOut());
      } catch {
        ok = false;
      }
      if (ok) {
        ctx.onSignedOut();
        return;
      }
      if (!ctx.alive()) return;
      out.disabled = false;
      showError(msg, 'ログアウトできませんでした（通信できません）');
    });

    setChildren(view,
      el('h1', { text: '設定' }),
      yt,
      msg,
      station,
      el('section', { class: 'settings-section' },
        el('h2', { text: 'アカウント' }),
        out,
        el('p', {}, el('a', { href: './guide.html', text: '使い方ガイド' })),
        el('p', {}, el('a', { href: './privacy.html', text: 'プライバシーポリシー' }))),
    );
  });
}

function connectButton(msg, ctx) {
  const btn = el('button', { type: 'button', text: 'YouTube につなぐ' });
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    msg.hidden = true;
    try {
      await connect(RETURN_TO);
    } catch {
      if (!ctx.alive()) return;
      btn.disabled = false;
      showError(msg, 'つなげませんでした。通信を確かめて、もう一度押してください');
    }
  });
  return btn;
}
