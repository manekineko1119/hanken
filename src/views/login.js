// ログイン画面。state: { denied: boolean, unknown: boolean }。
export function renderLogin(container, { denied = false, unknown = false, onSignIn }) {
  container.replaceChildren();

  const h1 = document.createElement('h1');
  h1.textContent = 'Liveapp';
  container.append(h1);

  if (denied || unknown) {
    const msg = document.createElement('p');
    msg.setAttribute('role', 'alert');
    msg.textContent = denied
      ? 'このアカウントは招待されていません'
      : '通信できないため、ログインを確かめられません';
    container.append(msg);
  }

  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = 'Google でログイン';
  button.addEventListener('click', onSignIn);
  container.append(button);
}
