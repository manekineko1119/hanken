import { el, setChildren, backLink, loadView } from '../ui/dom.js';
import { getPlaylist, resolveVideos, savePlaylist } from '../data/playlists.js';
import { getStatus, connect } from '../data/youtube.js';
import { splitTracks, saveSummary, saveErrorInfo, resolveErrorInfo, cleanName } from '../core/save-confirm.js';
import { playlistHref } from '../router.js';

const CONNECT_FAILED = 'YouTube につなげませんでした。もう一度試してください';

// 保存の確認の画面：名前・入れる曲・見つからなかった曲・非公開、を見せて、OK のあとで保存する。
export function renderPlaylistConfirm(container, ctx) {
  const id = ctx.params.id;
  const fromPrep = ctx.query?.from === 'prep';
  const backHref = playlistHref(id, { fromPrep });
  const load = async () => {
    const [pl, status] = await Promise.all([getPlaylist(id), getStatus()]);
    return { pl, status };
  };
  loadView(container, ctx, load, ({ pl, status }) => {
    if (!pl || !['prep', 'setlist'].includes(pl.kind)) {
      setChildren(container, backLink('#/prep', '戻る'), el('p', { class: 'note', text: 'このプレイリストは見つかりませんでした' }));
      return;
    }
    let resolved = null; // null：まだ探している
    let message = '';
    let saving = false;
    let result = null;
    const nameInput = el('input', { type: 'text', maxlength: '150', 'aria-label': 'プレイリストの名前', value: pl.title });
    const ok = el('button', { type: 'button', class: 'primary', text: 'OK（非公開で保存）' });

    const reconnect = async () => {
      try {
        await connect(playlistHref(id, { fromPrep, confirm: true }));
      } catch {
        if (!ctx.alive()) return;
        message = CONNECT_FAILED;
        // 曲の一覧がまだない（未接続など）ときは、つなぐ画面に戻す。「曲を探しています…」のままにしない。
        if (resolved) draw(); else drawDisconnected();
      }
    };

    const split = () => splitTracks(pl.tracks, resolved);
    const updateOk = () => {
      ok.disabled = saving || !!result || !resolved || !cleanName(nameInput.value) || split().found.length === 0;
    };

    ok.addEventListener('click', async () => {
      const name = cleanName(nameInput.value);
      if (saving || result || !name) return; // 二重に保存しない（YouTube にプレイリストが2つできてしまう）
      saving = true;
      message = '';
      draw();
      let needReconnect = false;
      try {
        result = await savePlaylist(id, name);
      } catch (e) {
        const info = saveErrorInfo(e);
        message = info.message;
        needReconnect = info.reconnect;
      }
      saving = false;
      if (result) ctx.onPlaylistSaved?.();
      if (!ctx.alive()) return;
      draw();
      if (needReconnect) reconnect();
    });
    nameInput.addEventListener('input', () => { if (resolved) { updateOk(); } });

    function draw() {
      const typed = nameInput.value;
      nameInput.disabled = saving || !!result;
      ok.textContent = saving ? '保存しています…' : 'OK（非公開で保存）';
      const head = [backLink(backHref, '戻る'), el('h1', { text: '保存の確認' })];
      if (!resolved) {
        setChildren(container, ...head, el('p', { class: 'note', text: '曲を探しています…' }),
          message ? el('p', { class: 'note error', role: 'alert', text: message }) : null);
        return;
      }
      const { found, missing } = split();
      updateOk();
      setChildren(container, ...head,
        el('label', { class: 'meta', text: 'プレイリストの名前' }),
        nameInput,
        !cleanName(typed) ? el('p', { class: 'note error', text: '名前は1〜150文字で入れてください' }) : null,
        el('p', { class: 'note', text: '非公開で保存します（自分だけが見られます）。YouTube で公開に変えたプレイリストには保存しません' }),
        pl.status === 'saved' ? el('p', { class: 'note', text: '前に保存したプレイリストの中身を、この曲で入れ替えます' }) : null,
        el('h2', { text: `入れる曲（${found.length}曲）` }),
        found.length
          ? el('ul', { class: 'list on-paper' }, ...found.map((t, i) => el('li', { class: 'artist-row' },
            el('span', { class: 'artist-name', text: `${i + 1}. ${t.title}` }),
            t.matchedTitle !== t.title ? el('span', { class: 'status', text: `YouTube Music では：${t.matchedTitle}` }) : null)))
          : el('p', { class: 'note', text: '入れられる曲がありません' }),
        missing.length ? el('h2', { text: 'YouTube Music で見つからなかった曲' }) : null,
        missing.length
          ? el('ul', { class: 'list on-paper' }, ...missing.map((t) => el('li', { class: 'artist-row' }, el('span', { class: 'artist-name', text: t.title }))))
          : null,
        missing.length ? el('p', { class: 'note', text: 'この曲は入りません' }) : null,
        message ? el('p', { class: 'note error', role: 'alert', text: message }) : null,
        result ? el('p', { class: 'note', role: 'status', text: saveSummary(result) }) : null,
        el('div', { class: 'actions' },
          result
            ? el('a', { class: 'button primary', href: result.url, target: '_blank', rel: 'noopener', text: 'YouTube Music で開く' })
            : ok));
      nameInput.value = typed;
    }

    function drawDisconnected() {
      const btn = el('button', { type: 'button', class: 'primary', text: 'YouTube につなぐ' });
      btn.addEventListener('click', () => { btn.disabled = true; message = ''; reconnect(); });
      setChildren(container, backLink(backHref, '戻る'), el('h1', { text: '保存の確認' }),
        el('p', { class: 'note', text: 'YouTube につながっていません。つなぐと、この画面に戻ります。次の画面で YouTube の項目にチェックを入れてください' }),
        message ? el('p', { class: 'note error', role: 'alert', text: message }) : null,
        el('div', { class: 'actions' }, btn));
    }

    if (!status.connected) {
      drawDisconnected();
      return;
    }
    if (pl.tracks.length === 0) {
      setChildren(container, backLink(backHref, '戻る'), el('h1', { text: '保存の確認' }), el('p', { class: 'note', text: '曲がありません。先に曲を足してください' }));
      return;
    }

    draw();
    (async () => {
      try {
        resolved = (await resolveVideos(id))?.tracks ?? [];
      } catch (e) {
        if (!ctx.alive()) return;
        if (e?.code === 'YT_RECONNECT') { reconnect(); return; }
        if (Array.isArray(e?.tracks)) {
          resolved = e.tracks;
          message = resolveErrorInfo(e);
        } else {
          setChildren(container, backLink(backHref, '戻る'), el('h1', { text: '保存の確認' }),
            el('p', { class: 'note error', role: 'alert', text: resolveErrorInfo(e) }));
          return;
        }
      }
      if (ctx.alive()) draw();
    })();
  });
}
