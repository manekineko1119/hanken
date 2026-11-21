begin;
select plan(4);

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000c1', 'c1@example.test');
insert into public.youtube_pending (id, user_id, refresh_token_enc, access_token_enc, expires_at) values
  ('old', '00000000-0000-0000-0000-0000000000c1', 'r', 'a', now() - interval '1 minute'),
  ('new', '00000000-0000-0000-0000-0000000000c1', 'r', 'a', now() + interval '5 minutes');

select is(has_table_privilege('authenticated', 'public.youtube_pending', 'select'), false, 'authenticated は youtube_pending を読めない');
select is(has_table_privilege('anon', 'public.youtube_pending', 'insert'), false, 'anon は youtube_pending に書けない');

select private.cleanup_youtube_data();
select is((select count(*)::int from public.youtube_pending where id = 'old'), 0, '片付けで期限の切れた保留が消える');
select is((select count(*)::int from public.youtube_pending where id = 'new'), 1, '期限の前の保留は残る');

select * from finish();
rollback;
