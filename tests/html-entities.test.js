import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeEntities } from '../supabase/functions/_shared/html-entities.js';

test('名前つきの文字：&amp; &lt; &gt; &quot; &apos;', () => {
  assert.equal(decodeEntities('Rock &amp; Roll &lt;3 &gt; &quot;x&quot; &apos;y&apos;'), 'Rock & Roll <3 > "x" \'y\'');
});
test('数字の参照：&#39; と &#x27; と &#12354;', () => {
  assert.equal(decodeEntities('Don&#39;t Stop &#x27;n&#X27; &#12354;'), "Don't Stop 'n' あ");
});
test('二重にはデコードしない（&amp;amp; は &amp; になる）', () => {
  assert.equal(decodeEntities('a &amp;amp; b'), 'a &amp; b');
});
test('知らない・壊れた参照はそのまま。空や null は空文字', () => {
  assert.equal(decodeEntities('&foo; &#; &#xZZ; &#99999999;'), '&foo; &#; &#xZZ; &#99999999;');
  assert.equal(decodeEntities(null), '');
  assert.equal(decodeEntities(undefined), '');
});
