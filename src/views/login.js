import { setChildren, el } from '../ui/dom.js';

// 半券がミシン目で切れる動きの長さ（login.css の .login-ticket.torn と合わせる）。
const TEAR_MS = 420;

// ログイン画面。もぎる前の入場券の形。
// ボタンを押すと右の半券が切れてから（動きを減らす設定なら、すぐに）ログインを始める。
export function renderLogin(container, { denied = false, unknown = false, startFailed = false, onSignIn }) {
  const stub = el('div', { class: 'login-stub', 'aria-hidden': 'true' }, 'ADMIT', el('br'), 'ONE');
  const ticket = el('div', { class: 'login-ticket' },
    el('div', { class: 'login-body' },
      el('p', { class: 'login-sub', text: 'LIVE TICKET STUB' }),
      el('h1', { text: '半券' }),
    ),
    stub,
  );

  const notice = (denied || unknown)
    ? el('p', {
        class: 'login-alert',
        role: 'alert',
        text: denied ? 'このアカウントは招待されていません' : '通信できないため、ログインを確かめられません',
      })
    : null;

  const button = el('button', { type: 'button', class: 'login-button', text: 'Google でログイン' });
  button.addEventListener('click', () => {
    if (ticket.classList.contains('torn')) return;
    const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) {
      onSignIn();
      return;
    }
    ticket.classList.add('torn');
    button.disabled = true;
    setTimeout(() => {
      button.disabled = false;
      onSignIn();
    }, TEAR_MS);
  });

  const err = startFailed
    ? el('p', { class: 'login-alert', role: 'alert', text: 'ログインを始められませんでした。通信を確かめてください' })
    : null;

  setChildren(container, el('section', { class: 'login' }, ticket, notice, button, err));
}
