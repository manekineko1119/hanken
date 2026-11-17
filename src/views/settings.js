import { el, setChildren, loadView } from '../ui/dom.js';
import { signOut } from '../auth/auth.js';
import { getStatus, connect, disconnect } from '../data/youtube.js';
import { daysLeft } from '../core/youtube.js';

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
  loadView(view, ctx, getStatus, (status) => {
    const msg = el('p', { class: 'note error', role: 'alert', hidden: true });
    const notice = NOTICES[ctx.query?.yt];
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
      el('section', { class: 'settings-section' },
        el('h2', { text: 'アカウント' }),
        out,
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
