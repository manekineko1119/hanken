// セトリを作る画面：画像（スクショ・写真）か貼り付けた文字から、下書きのセトリを作る。
// 画像と読めた文字は、どこにもログ・保存しない（設計 8.2）。
import { el, setChildren, backLink, loadView } from '../ui/dom.js';
import { getLive } from '../data/lives.js';
import { readSetlistImages, findSetlist, createSetlist, replaceSetlistTracks } from '../data/setlist.js';
import { linesFromText, toSetlist, toSetlistTracks } from '../core/setlist.js';
import { fitSize, fitsTotal } from '../core/image.js';
import { formatDateJa } from '../core/lives.js';
import { playlistTitle } from '../core/naming.js';
import { playlistHref } from '../router.js';

const MAX_IMAGES = 4;
const JPEG_QUALITY = 0.85;
const MSG = {
  tooMany: '4枚まで選べます',
  empty: '読めませんでした。文字を貼り付けて作れます',
  month: '今月の画像の読み取りはいっぱいです。文字を貼り付けて作れます',
  day: '今日の画像の読み取りはいっぱいです（1日10回まで）。文字を貼り付けて作れます',
  failed: '読み取りに失敗しました。もう一度試すか、文字を貼り付けて作れます',
  saveFailed: '保存できませんでした。通信を確かめてください',
  tooBig: '画像が大きすぎます。枚数を減らすか、文字を貼り付けて作れます',
  pasteEmpty: '文字を貼り付けてください',
};
export const REPLACE_CONFIRM = '今のセトリを、読み取った内容で置き換えますか？';

// 画像を長い辺 1600px までに縮めた JPEG にして、base64（前の「data:…」は付けない）で返す。
async function toBase64(file, { max = 1600, quality = JPEG_QUALITY } = {}) {
  const bitmap = await createImageBitmap(file);
  try {
    const { w, h } = fitSize(bitmap.width, bitmap.height, max);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h);
    return canvas.toDataURL('image/jpeg', quality).split(',')[1];
  } finally {
    bitmap.close?.();
  }
}

export function renderSetlistRead(container, ctx) {
  const { id: liveId, artistId } = ctx.params;
  loadView(container, ctx, () => getLive(liveId), (live) => {
    const artist = live?.artists.find((a) => a.id === artistId);
    if (!artist) {
      setChildren(container, backLink('#/lives', '一覧へ'), el('p', { class: 'note', text: 'このライブは見つかりませんでした' }));
      return;
    }
    const venue = typeof live.venue === 'string' ? live.venue.trim() : '';
    const back = `#/live/${encodeURIComponent(liveId)}`;
    let busy = false;

    const file = el('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true, 'aria-label': 'スクショ・写真' });
    const pick = el('button', { type: 'button', class: 'primary pick', text: 'スクショ・写真を選ぶ' });
    const paste = el('textarea', { 'aria-label': 'セトリの文字', placeholder: '曲名を1行に1曲ずつ貼り付けてください' });
    const make = el('button', { type: 'button', text: 'この文字で作る' });
    const msg = el('p', { class: 'note error', role: 'alert', hidden: true });
    const box = el('details', { class: 'paste-box' }, el('summary', { text: '文字を貼り付けて作る' }), paste, el('div', { class: 'actions' }, make));

    function lock(on) {
      busy = on;
      for (const n of [pick, make, paste]) n.disabled = on;
      file.disabled = on;
    }
    function say(text, { openPaste = false } = {}) {
      msg.textContent = text;
      msg.hidden = !text;
      if (openPaste) box.open = true;
    }

    // 読めた行 → 下書きのセトリ → 編集の画面へ。
    async function build(lines) {
      const { songs } = toSetlist(lines);
      if (!songs.length) { say(MSG.empty, { openPaste: true }); return; }
      const tracks = toSetlistTracks(songs, artist.name);
      let existing;
      try {
        existing = await findSetlist(artist.id);
      } catch {
        say(MSG.saveFailed);
        return;
      }
      if (!ctx.alive()) return;
      if (existing && !confirm(REPLACE_CONFIRM)) return;
      try {
        let id = existing?.id;
        if (id) await replaceSetlistTracks(id, tracks);
        else id = await createSetlist({
          liveId, liveArtistId: artist.id, artistName: artist.name, tracks,
          title: playlistTitle({ kind: 'setlist', artistName: artist.name, date: live.date, venue: venue || undefined }),
        });
        if (ctx.alive()) location.hash = playlistHref(id);
      } catch {
        say(MSG.saveFailed);
      }
    }

    async function run(task) {
      if (busy) return;
      lock(true);
      say('');
      try {
        await task();
      } finally {
        if (ctx.alive()) lock(false);
      }
    }

    pick.addEventListener('click', () => { if (!busy) file.click(); });
    file.addEventListener('change', () => {
      const files = [...file.files];
      file.value = '';
      if (!files.length) return;
      if (files.length > MAX_IMAGES) { say(MSG.tooMany); return; }
      run(async () => {
        let images;
        try {
          images = await Promise.all(files.map((f) => toBase64(f)));
          // サーバーの 4MB に収まらなければ、画質→大きさの順に下げてやり直す。
          for (const opt of [{ quality: 0.7 }, { max: 1200, quality: 0.7 }]) {
            if (fitsTotal(images)) break;
            images = await Promise.all(files.map((f) => toBase64(f, opt)));
          }
        } catch {
          say(MSG.failed, { openPaste: true }); // HEIC など、ブラウザが開けない画像
          return;
        }
        if (!fitsTotal(images)) { say(MSG.tooBig, { openPaste: true }); return; } // サーバーは呼ばない
        let r;
        try {
          r = await readSetlistImages(images);
        } catch {
          if (ctx.alive()) say(MSG.failed, { openPaste: true });
          return;
        }
        if (!ctx.alive()) return;
        if (r.limit) say(r.limit === 'month' ? MSG.month : MSG.day, { openPaste: true });
        else await build(r.lines);
      });
    });
    make.addEventListener('click', () => {
      if (!paste.value.trim()) { say(MSG.pasteEmpty); return; }
      run(() => build(linesFromText(paste.value)));
    });

    setChildren(container,
      backLink(back, '戻る'),
      el('h1', { text: 'セトリを作る' }),
      el('p', { class: 'meta', text: `${artist.name}／${formatDateJa(live.date)}${venue ? ` ${venue}` : ''}` }),
      el('div', { class: 'actions pick-actions' }, pick),
      file,
      el('p', { class: 'note', text: '4枚まで。X・インスタのスクショ、セトリの紙の写真が読めます' }),
      msg,
      box,
      el('p', { class: 'note small', text: '画像と読めた文字そのものは保存しません。読めた曲名は下書きのセトリになります。' }),
    );
  });
}
