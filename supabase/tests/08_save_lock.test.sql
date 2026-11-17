begin;
select plan(9);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000b1', 'b1@example.test'),
  ('00000000-0000-0000-0000-0000000000b2', 'b2@example.test');
insert into public.playlists (id, user_id, kind, artist_name, title, status, candidates) values
  ('44444444-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000b1', 'prep', 'B artist', 'B playlist', 'draft', '{"popular":[],"recent":[]}');

select is(public.claim_playlist_save('44444444-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000b1', 120), true, '空いていれば鍵が取れる');
select isnt((select save_locked_until from public.playlists where id = '44444444-0000-0000-0000-000000000001'), null, '鍵の時刻が入る');
select is(public.claim_playlist_save('44444444-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000b1', 120), false, '鍵がかかっているあいだは取れない');
select is(public.claim_playlist_save('44444444-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000b2', 120), false, '他人は取れない');

update public.playlists set save_locked_until = now() - interval '1 second' where id = '44444444-0000-0000-0000-000000000001';
select is(public.claim_playlist_save('44444444-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000b1', 120), true, '期限が切れていれば取れる');

select public.release_playlist_save('44444444-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000b2');
select isnt((select save_locked_until from public.playlists where id = '44444444-0000-0000-0000-000000000001'), null, '他人は鍵を外せない');
select public.release_playlist_save('44444444-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000b1');
select is((select save_locked_until from public.playlists where id = '44444444-0000-0000-0000-000000000001'), null, '持ち主は鍵を外せる');

select is(has_function_privilege('authenticated', 'public.claim_playlist_save(uuid, uuid, int)', 'execute'), false, 'authenticated は claim を呼べない');
select is(has_function_privilege('service_role', 'public.claim_playlist_save(uuid, uuid, int)', 'execute'), true, 'service_role は claim を呼べる');

select * from finish();
rollback;
