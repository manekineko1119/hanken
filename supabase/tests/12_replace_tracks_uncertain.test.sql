begin;
select plan(4);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'a@example.test');
insert into public.allowed_emails (email) values ('a@example.test');
insert into public.playlists (id, user_id, kind, artist_name, title, candidates) values
  ('33333333-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', 'prep', 'X', 'P', '{"popular":[],"recent":[]}');

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000000a1', 'email', 'a@example.test', 'role', 'authenticated')::text, true);

select lives_ok($$select public.replace_playlist_tracks('33333333-0000-0000-0000-000000000001',
  '[{"position":0,"title":"A","artist_name":"X","source":"setlist","is_latest":false,"uncertain":true},{"position":1,"title":"B","artist_name":"X","source":"setlist","is_latest":false}]'::jsonb,
  '{"popular":[],"recent":[]}'::jsonb)$$, 'uncertain つきで入れ替えられる');
select results_eq($$select title, uncertain from public.playlist_tracks order by position$$,
  $$values ('A', true), ('B', false)$$, 'A は true、なしの B は false');

select lives_ok($$select public.replace_playlist_tracks('33333333-0000-0000-0000-000000000001',
  '[{"position":0,"title":"S","artist_name":"X","source":"setlist","uncertain":true},{"position":1,"title":"S","artist_name":"X","source":"setlist","uncertain":false}]'::jsonb,
  '{"popular":[],"recent":[]}'::jsonb)$$, '同じ曲名が 2 つでも入れ替えられる');
select is((select count(*)::int from public.playlist_tracks), 2, '同じ曲名でも 2 行入る');

select * from finish();
rollback;
