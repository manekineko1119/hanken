import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitTracks, saveSummary, saveErrorInfo, resolveErrorInfo, cleanName, confirmReturnTo } from '../src/core/save-confirm.js';

const tracks = [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }, { id: 'c', title: 'C' }];

test('splitTracks: 見つかった曲と見つからなかった曲に分ける（順番は元のまま）', () => {
  const r = splitTracks(tracks, [
    { id: 'c', videoId: 'v3', videoTitle: 'C (official)' },
    { id: 'a', videoId: 'v1', videoTitle: 'A (official)' },
    { id: 'b', videoId: null, videoTitle: null },
  ]);
  assert.deepEqual(r.found, [{ title: 'A', matchedTitle: 'A (official)' }, { title: 'C', matchedTitle: 'C (official)' }]);
  assert.deepEqual(r.missing, [{ title: 'B' }]);
});

test('splitTracks: 結果にない曲は「見つからなかった」に入れる', () => {
  const r = splitTracks(tracks, [{ id: 'a', videoId: 'v1', videoTitle: 'A!' }]);
  assert.equal(r.found.length, 1);
  assert.deepEqual(r.missing.map((m) => m.title), ['B', 'C']);
});

test('splitTracks: 入力が変でも落ちない', () => {
  assert.deepEqual(splitTracks(null, null), { found: [], missing: [] });
  assert.equal(splitTracks(tracks, null).missing.length, 3);
});

test('splitTracks: 見つけた曲に名前がないときは曲名で代える', () => {
  const r = splitTracks(tracks, [{ id: 'a', videoId: 'v1', videoTitle: null }]);
  assert.equal(r.found[0].matchedTitle, 'A');
});

test('saveSummary: 全部入った', () => {
  assert.equal(saveSummary({ inserted: 10, skipped: 0 }), '10曲を入れました');
});
test('saveSummary: 飛ばした曲がある', () => {
  assert.equal(saveSummary({ inserted: 8, skipped: 2 }), '8曲を入れました。2曲は見つからなかったので入れていません');
});
test('saveSummary: 数が変なら0として扱う', () => {
  assert.equal(saveSummary({}), '0曲を入れました');
});

test('saveErrorInfo: YT_RECONNECT はつなぎ直しへ進む', () => {
  const r = saveErrorInfo({ code: 'YT_RECONNECT' });
  assert.equal(r.reconnect, true);
});
test('saveErrorInfo: QUOTA は設計の文（サーバーの文があればそれ）', () => {
  assert.match(saveErrorInfo({ code: 'QUOTA' }).message, /日本時間の17時ごろ/);
  assert.equal(saveErrorInfo({ code: 'QUOTA', message: '今日は保存できる回数を超えました' }).message, '今日は保存できる回数を超えました');
});
test('saveErrorInfo: UPSTREAM は途中までの数と、もう一度押せることを伝える', () => {
  const r = saveErrorInfo({ code: 'UPSTREAM', inserted: 3, skipped: 0 });
  assert.match(r.message, /3曲/);
  assert.match(r.message, /もう一度/);
  assert.equal(r.reconnect, false);
});
test('saveErrorInfo: BAD_INPUT・不明', () => {
  assert.match(saveErrorInfo({ code: 'BAD_INPUT' }).message, /入れられる曲/);
  assert.match(saveErrorInfo({}).message, /保存できませんでした/);
  assert.match(saveErrorInfo(null).message, /保存できませんでした/);
});
test('エラーの文に「動画」を使わない', () => {
  for (const code of ['QUOTA', 'YT_RECONNECT', 'UPSTREAM', 'BAD_INPUT', 'X']) {
    assert.doesNotMatch(saveErrorInfo({ code }).message, /動画/);
    assert.doesNotMatch(resolveErrorInfo({ code }), /動画/);
  }
});

test('resolveErrorInfo: QUOTA は「今日はこれ以上曲を探せません」', () => {
  assert.match(resolveErrorInfo({ code: 'QUOTA' }), /今日はこれ以上曲を探せません/);
  assert.match(resolveErrorInfo({ code: 'UPSTREAM' }), /曲を探せませんでした/);
  assert.match(resolveErrorInfo(null), /曲を探せませんでした/);
});

test('cleanName: 前後の空白を除く。空なら null', () => {
  assert.equal(cleanName('  【予習】A  '), '【予習】A');
  assert.equal(cleanName('   '), null);
  assert.equal(cleanName(undefined), null);
});
test('cleanName: 150文字を超える名前は断る', () => {
  assert.equal(cleanName('a'.repeat(151)), null);
  assert.equal(cleanName('a'.repeat(150)).length, 150);
});

test('confirmReturnTo: 確認の画面へ戻るハッシュ', () => {
  assert.equal(confirmReturnTo('abc-123'), '#/playlist/abc-123?confirm=1');
  assert.equal(confirmReturnTo('a b'), '#/playlist/a%20b?confirm=1');
});

test('saveErrorInfo: BUSY（保存中）はサーバーの文言を出し、つなぎ直さない', () => {
  const r = saveErrorInfo({ code: 'BUSY', message: '保存中です。少し待ってからもう一度押してください' });
  assert.equal(r.message, '保存中です。少し待ってからもう一度押してください');
  assert.equal(r.reconnect, false);
  assert.equal(saveErrorInfo({ code: 'BUSY' }).message, '保存中です。少し待ってからもう一度押してください');
});
