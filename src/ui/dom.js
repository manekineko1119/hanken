// DOM を作る小さな部品。データは textContent だけで入れる（innerHTML は使わない）。

// null・undefined・false を除く。replaceChildren/append に渡すと「null」という文字になるため。
export function compact(children) {
  return children.filter((c) => c !== null && c !== undefined && c !== false);
}

// container の中身を入れ替える。null などは無視する。
export function setChildren(container, ...children) {
  container.replaceChildren(...compact(children));
}

// container の後ろに足す。null などは無視する。
export function appendChildren(container, ...children) {
  container.append(...compact(children));
}

export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  appendChildren(node, ...children);
  return node;
}

export function backLink(href, label) {
  return el('a', { class: 'back', href, text: label });
}

// ゴミ箱のアイコン（SVG。色は currentColor）。装飾なので読み上げない。
export function trashIcon() {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  for (const [k, v] of Object.entries({
    viewBox: '0 0 24 24', width: '22', height: '22', fill: 'none', stroke: 'currentColor',
    'stroke-width': '1.8', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false',
  })) svg.setAttribute(k, v);
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d', 'M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13M10 11v6M14 11v6');
  svg.append(path);
  return svg;
}

// 読み込み中 → 成功なら build(data)、失敗なら読み込みエラーを出す。
// 画面が切り替わったあとに終わった読み込みは捨てる（ctx.alive）。
// チラつきを防ぐため、読み込みが LOADING_DELAY_MS より早く終われば「読み込み中…」は出さず、
// それまでは前の中身を押せない状態（inert）で残しておく。
const LOADING_DELAY_MS = 300;

export function setBusy(container, busy) {
  container.inert = busy;
  if (busy) container.setAttribute?.('aria-busy', 'true');
  else container.removeAttribute?.('aria-busy');
}

export async function loadView(container, ctx, load, build) {
  setBusy(container, true);
  const timer = setTimeout(() => {
    if (ctx.alive()) container.replaceChildren(el('p', { class: 'note', text: '読み込み中…' }));
  }, LOADING_DELAY_MS);
  let data;
  let failed = false;
  try {
    data = await load();
  } catch {
    failed = true;
  } finally {
    clearTimeout(timer);
  }
  if (!ctx.alive()) return;
  setBusy(container, false);
  if (failed) {
    container.replaceChildren(el('p', { class: 'note error', role: 'alert', text: '読み込めませんでした。通信を確かめてください' }));
    return;
  }
  build(data);
}
