import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickVideo } from '../supabase/functions/_shared/youtube-pick.js';

const v = (videoId, channelTitle, title = 'Song', durationSec = 200) => ({ videoId, title, channelTitle, durationSec });

// 実際の検索結果（「ミセカイ 104Hz」、videoCategoryId=10）。再生時間は目安。
const TOPIC1 = v('t1', 'Misekai - Topic', '104Hz', 273);
const TOPIC2 = v('t2', 'Misekai - Topic', '104Hz', 273);
const SHORT = v('s3', 'ミセカイ -Misekai-', '「104Hz」vocal Onlyver.', 39);
const OTHER_SONG = v('o4', 'ミセカイ -Misekai-', 'ミセカイ - アオイハル / Aoiharu [Official Music Video]', 240);
const LIVE = v('l5', 'ミセカイ -Misekai-', '104Hz Live Movie', 47);
const COVER = v('c6', 'ファンA', '【ニコカラ】104Hz (off vocal)', 270);
const COVER2 = v('c7', 'ファンB', '104Hz 歌ってみた', 260);
const COVER3 = v('c8', 'ファンC', '104Hz / ミセカイ cover', 255);
const REAL = [TOPIC1, TOPIC2, SHORT, OTHER_SONG, LIVE, COVER, COVER2, COVER3];

test('実際の結果：ローマ字の Topic（曲名が同じ）を選び、ショートは選ばない', () => {
  assert.equal(pickVideo(REAL, 'ミセカイ', '104Hz').videoId, 't1');
});

test('Topic がない結果で、曲名を含む正しい動画がなければ null（別の曲は選ばない）', () => {
  assert.equal(pickVideo(REAL.slice(2), 'ミセカイ', '104Hz'), null);
});

test('Topic がなくても、アーティスト名を含まないチャンネルの正しい曲（曲名を含む）は選ぶ', () => {
  const upload = v('u', 'レーベルX', 'ミセカイ「104Hz」MV', 270);
  assert.equal(pickVideo([...REAL.slice(2), upload], 'ミセカイ', '104Hz').videoId, 'u');
});

test('短い名前の Topic（Kai - Topic）は、ミセカイ -Misekai- と同じアーティスト扱いにしない', () => {
  const kai = v('kai', 'Kai - Topic', '104Hz', 273);
  assert.equal(pickVideo([kai, OTHER_SONG, v('y', 'ミセカイ公式', '104Hz', 200)], 'ミセカイ', '104Hz').videoId, 'y');
  assert.equal(pickVideo([kai, TOPIC1, SHORT], 'ミセカイ', '104Hz').videoId, 't1');
});

test('別のアーティストの Topic は、同じ曲名でも選ばない', () => {
  const items = [v('x', 'Other - Topic', '104Hz', 200), v('y', 'ミセカイ公式', '104Hz', 200)];
  assert.equal(pickVideo(items, 'ミセカイ', '104Hz').videoId, 'y');
});

test('アーティスト名と同じ Topic が、ローマ字の Topic より優先される', () => {
  const items = [TOPIC1, v('exact', 'ミセカイ - Topic', '104Hz', 273), SHORT];
  assert.equal(pickVideo(items, 'ミセカイ', '104Hz').videoId, 'exact');
});

test('Topic でも曲名が違えば選ばない', () => {
  const items = [v('a', 'バンドA - Topic', '別の曲'), v('b', 'バンドA 公式', '曲1')];
  assert.equal(pickVideo(items, 'バンドA', '曲1').videoId, 'b');
});

test('Topic がなければ、アーティスト名を含むチャンネルで曲名を含む別バージョンでない動画（official を優先）', () => {
  const items = [
    v('1', 'バンドA', '曲1 (Live)'),
    v('2', 'バンドA', '曲1 MV'),
    v('3', 'バンドA', '曲1 [Official Music Video]'),
  ];
  assert.equal(pickVideo(items, 'バンドA', '曲1').videoId, '3');
});

test('曲名そのものに別バージョンの言葉があるときは、別バージョン扱いしない', () => {
  const items = [v('1', 'ファン', 'other'), v('2', 'バンドA', 'Live Forever')];
  assert.equal(pickVideo(items, 'バンドA', 'Live Forever').videoId, '2');
});

test('アーティスト名を含まないチャンネルでも、曲名を含む別バージョンでない動画を選ぶ', () => {
  const items = [v('1', 'ファン', '無関係'), v('2', 'ファン', '曲1 cover'), v('3', 'レーベル', '曲1')];
  assert.equal(pickVideo(items, 'バンドA', '曲1').videoId, '3');
});

test('曲名がないときだけ、ショートでない先頭。曲名があって見つからなければ null。空なら null', () => {
  assert.equal(pickVideo([v('1', 'x', 'a', 30), v('2', 'y', 'b'), v('3', 'z', 'c')], 'バンドA', '').videoId, '2');
  assert.equal(pickVideo([v('2', 'y', 'b'), v('3', 'z', 'c')], 'バンドA', '曲1'), null);
  assert.equal(pickVideo([], 'バンドA', '曲1'), null);
  assert.equal(pickVideo(undefined, 'バンドA', '曲1'), null);
  assert.equal(pickVideo([v('1', 'x', 'a', 30)], 'バンドA', '曲1'), null);
});

test('再生時間がわからない動画は、ショート扱いしない', () => {
  const items = [{ videoId: '1', title: '曲1', channelTitle: 'バンドA - Topic' }];
  assert.equal(pickVideo(items, 'バンドA', '曲1').videoId, '1');
});
