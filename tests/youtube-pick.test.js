import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickVideo } from '../supabase/functions/_shared/youtube-pick.js';

const v = (videoId, channelTitle) => ({ videoId, title: 't' + videoId, channelTitle });

test('「<アーティスト名> - Topic」のチャンネルは、先頭でなくても選ぶ', () => {
  const items = [v('1', 'ファンのチャンネル'), v('2', 'バンドA 公式'), v('3', 'バンドA - Topic')];
  assert.equal(pickVideo(items, 'バンドA').videoId, '3');
});

test('Topic がなければ、チャンネル名にアーティスト名を含むもの', () => {
  const items = [v('1', 'ファン'), v('2', 'バンドA Official')];
  assert.equal(pickVideo(items, 'バンドA').videoId, '2');
});

test('どちらもなければ先頭、空なら null', () => {
  assert.equal(pickVideo([v('1', 'x'), v('2', 'y')], 'バンドA').videoId, '1');
  assert.equal(pickVideo([], 'バンドA'), null);
  assert.equal(pickVideo(undefined, 'バンドA'), null);
});

test('別のアーティストの Topic は選ばない', () => {
  const items = [v('1', 'ファン'), v('2', 'バンドB - Topic')];
  assert.equal(pickVideo(items, 'バンドA').videoId, '1');
});
