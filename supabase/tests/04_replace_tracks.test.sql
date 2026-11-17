begin;
select plan(11);

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

-- 動画の割り当て：同じ曲（曲名とアーティスト名が同じ）なら引き継ぐ
update public.playlist_tracks set video_id = 'vid1', video_title = 'Video 1', video_checked_at = '2026-11-01T00:00:00Z' where title = 'n1';
select lives_ok($$select public.replace_playlist_tracks('33333333-0000-0000-0000-000000000001',
  '[{"position":0,"title":"n3","artist_name":"A artist","source":"manual"},{"position":1,"title":"n1","artist_name":"A artist","source":"lastfm"},{"position":2,"title":"n1","artist_name":"B artist","source":"manual"}]'::jsonb,
  '{"popular":[],"recent":[]}'::jsonb)$$, '動画つきの曲を含めて入れ替えられる');
select results_eq($$select title, artist_name, video_id, video_title, video_checked_at from public.playlist_tracks order by position$$,
  $$values ('n3'::text, 'A artist'::text, null::text, null::text, null::timestamptz),
           ('n1', 'A artist', 'vid1', 'Video 1', '2026-11-01T00:00:00Z'::timestamptz),
           ('n1', 'B artist', null, null, null)$$,
  '同じ曲は動画を引き継ぎ、新しい曲・アーティスト違いは空のまま');
select lives_ok($$select public.replace_playlist_tracks('33333333-0000-0000-0000-000000000001',
  '[{"position":0,"title":"n1","artist_name":"A artist","source":"lastfm"}]'::jsonb, '{"popular":[],"recent":[]}'::jsonb)$$, '曲を減らしても入れ替えられる');
select is((select video_id from public.playlist_tracks where title = 'n1'), 'vid1', '残した曲は動画を保ったまま');

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
