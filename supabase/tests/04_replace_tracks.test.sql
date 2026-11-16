begin;
select plan(7);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'a@example.test'),
  ('00000000-0000-0000-0000-0000000000b1', 'b@example.test');
insert into public.allowed_emails (email) values ('a@example.test'), ('b@example.test');
insert into public.playlists (id, user_id, kind, artist_name, title, candidates) values
  ('33333333-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', 'prep', 'A artist', 'A playlist', '{"popular":[],"recent":[]}');
insert into public.playlist_tracks (playlist_id, user_id, position, title, artist_name, source) values
  ('33333333-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', 0, 'old1', 'A artist', 'itunes'),
  ('33333333-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', 1, 'old2', 'A artist', 'itunes');

-- 本人：入れ替わる
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000000a1', 'email', 'a@example.test', 'role', 'authenticated')::text, true);
select lives_ok($$select public.replace_playlist_tracks('33333333-0000-0000-0000-000000000001',
  '[{"position":0,"title":"n1","artist_name":"A artist","source":"lastfm","is_latest":false},{"position":1,"title":"n2","artist_name":"A artist","source":"manual","is_latest":true}]'::jsonb,
  '{"popular":[],"recent":[{"title":"r","source":"itunes"}]}'::jsonb)$$, '本人は曲を入れ替えられる');
select results_eq($$select position, title, source, is_latest from public.playlist_tracks order by position$$,
  $$values (0, 'n1', 'lastfm', false), (1, 'n2', 'manual', true)$$, '曲と順番が指定どおりになる');
select is((select candidates->'recent'->0->>'title' from public.playlists), 'r', '候補も更新される');

-- 壊れた行：全体が失敗し、元の曲が残る
select throws_ok($$select public.replace_playlist_tracks('33333333-0000-0000-0000-000000000001',
  '[{"position":0,"title":"x1","artist_name":"A artist","source":"lastfm"},{"position":1,"title":"x2","artist_name":"A artist","source":"bogus"}]'::jsonb,
  '{"popular":[],"recent":[]}'::jsonb)$$, '23514', null, '不正な source は失敗する');
select results_eq($$select title from public.playlist_tracks order by position$$,
  $$values ('n1'), ('n2')$$, '失敗したら元の曲が残る');

-- 他人：失敗し、何も変わらない
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000000b1', 'email', 'b@example.test', 'role', 'authenticated')::text, true);
select throws_ok($$select public.replace_playlist_tracks('33333333-0000-0000-0000-000000000001', '[]'::jsonb, null)$$,
  'P0002', null, '他人のプレイリストは入れ替えられない');

-- anon：実行できない
reset role;
set local role anon;
select throws_ok($$select public.replace_playlist_tracks('33333333-0000-0000-0000-000000000001', '[]'::jsonb, null)$$,
  '42501', null, 'anon は実行できない');

select * from finish();
rollback;
