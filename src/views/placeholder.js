import { el } from '../ui/dom.js';
import { signOut } from '../auth/auth.js';

export function renderPrep(container) {
  container.replaceChildren(el('h1', { text: '予習だけ' }), el('p', { class: 'note', text: '準備中です' }));
}

export function renderSettings(container) {
  const msg = el('p', { class: 'note error', role: 'alert', hidden: true });
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
      location.hash = '#/login';
      return;
    }
    out.disabled = false;
    msg.textContent = 'ログアウトできませんでした（通信できません）';
    msg.hidden = false;
  });
  container.replaceChildren(el('h1', { text: '設定' }), el('p', { class: 'note', text: '準備中です' }), out, msg);
}
