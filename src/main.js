import { parseHash } from './router.js';

const main = document.querySelector('main');

function render() {
  const route = parseHash(location.hash);
  main.textContent = route.path;
}

window.addEventListener('hashchange', render);
render();
