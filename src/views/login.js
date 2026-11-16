import { setChildren, appendChildren } from '../ui/dom.js';
// ログイン画面。state: { denied: boolean, unknown: boolean }。
export function renderLogin(container, { denied = false, unknown = false, startFailed = false, onSignIn }) {
  setChildren(container);

  const h1 = document.createElement('h1');
  h1.textContent = '半券';
  const sub = document.createElement('p');
  sub.textContent = 'LIVE TICKET STUB';
  appendChildren(container, h1, sub);

  if (denied || unknown) {
    const msg = document.createElement('p');
    msg.setAttribute('role', 'alert');
    msg.textContent = denied
      ? 'このアカウントは招待されていません'
      : '通信できないため、ログインを確かめられません';
    appendChildren(container, msg);
  }

  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = 'Google でログイン';
  button.addEventListener('click', onSignIn);
  appendChildren(container, button);

  if (startFailed) {
    const err = document.createElement('p');
    err.setAttribute('role', 'alert');
    err.textContent = 'ログインを始められませんでした。通信を確かめてください';
    appendChildren(container, err);
  }
}
