begin;
select plan(4);

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000a1', 'a@example.test');
insert into public.allowed_emails (email) values ('a@example.test');
insert into public.playlists (id, user_id, kind, artist_name, title, status, saved_at, candidates) values
  ('33333333-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', 'prep', 'A artist', 'A playlist', 'saved', '2026-11-01T00:00:00Z', '{"popular":[],"recent":[]}');

select is((select edited_at from public.playlists), null, '作ったばかりは edited_at が空');

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000000a1', 'email', 'a@example.test', 'role', 'authenticated')::text, true);
select lives_ok($$select public.replace_playlist_tracks('33333333-0000-0000-0000-000000000001',
  '[{"position":0,"title":"n1","artist_name":"A artist","source":"lastfm"}]'::jsonb, '{"popular":[],"recent":[]}'::jsonb)$$, '曲を入れ替えられる');
select isnt((select edited_at from public.playlists), null, '入れ替えると edited_at が入る');
select ok((select edited_at > saved_at from public.playlists), '保存のあとの編集なので edited_at の方が新しい');

select * from finish();
rollback;
