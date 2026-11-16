begin;
select plan(18);

-- ---------- 準備（postgres）----------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'a@example.test');
insert into public.allowed_emails (email, note) values ('a@example.test', 'test');
insert into public.youtube_connections (user_id, channel_title, refresh_token_enc, access_token_enc)
  values ('00000000-0000-0000-0000-0000000000a1', 'my channel', 'secret-refresh', 'secret-access');
insert into public.oauth_states (state, user_id, code_verifier)
  values ('s1', '00000000-0000-0000-0000-0000000000a1', 'verifier');
insert into public.track_cache (artist_key, payload) values ('k', '{}'::jsonb);
insert into public.video_cache (artist_key, title_key, video_id) values ('k', 't', 'v');
insert into public.api_usage (day_pt) values ('2026-12-01');
insert into public.user_daily_usage (user_id, day_jst, kind, count)
  values ('00000000-0000-0000-0000-0000000000a1', '2026-12-01', 'search', 1);

-- allowed_emails の CHECK（postgres）
select throws_ok(
  $$insert into public.allowed_emails (email) values (' padded@example.test ')$$,
  '23514', null, '前後に空白があるメールは allowed_emails に入れられない');
select throws_ok(
  $$insert into public.allowed_emails (email) values ('Upper@example.test')$$,
  '23514', null, '大文字を含むメールは allowed_emails に入れられない');

-- ---------- 許可済みの A として ----------
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000000a1', 'email', 'a@example.test', 'role', 'authenticated')::text, true);

select throws_ok($$select * from public.youtube_connections$$, '42501', null, 'authenticated は youtube_connections を読めない');
select throws_ok($$select * from public.oauth_states$$, '42501', null, 'authenticated は oauth_states を読めない');
select throws_ok($$select * from public.track_cache$$, '42501', null, 'authenticated は track_cache を読めない');
select throws_ok($$select * from public.video_cache$$, '42501', null, 'authenticated は video_cache を読めない');
select throws_ok($$select * from public.api_usage$$, '42501', null, 'authenticated は api_usage を読めない');
select throws_ok($$select * from public.user_daily_usage$$, '42501', null, 'authenticated は user_daily_usage を読めない');
select throws_ok($$select * from public.allowed_emails$$, '42501', null, 'authenticated は allowed_emails を読めない');
select throws_ok(
  $$insert into public.allowed_emails (email) values ('self@example.test')$$,
  '42501', null, 'authenticated は allowed_emails に書けない');

-- youtube_connection_status は鍵の列を返さない
select results_eq(
  $$select connected, channel_title from public.youtube_connection_status()$$,
  $$values (true, 'my channel'::text)$$,
  '許可済みの A は自分の接続状態（connected と channel_title）を取れる');
select is(
  (select proargnames from pg_proc where oid = 'public.youtube_connection_status'::regproc),
  array['connected','channel_title','connected_at'],
  'youtube_connection_status の列は connected / channel_title / connected_at だけ（鍵の列は返さない）');

select is(public.am_i_allowed(), true, '許可済みの A は am_i_allowed() が true');

-- ---------- 許可リストから外すと connected=false（修正3）----------
reset role;
delete from public.allowed_emails where email = 'a@example.test';
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000000a1', 'email', 'a@example.test', 'role', 'authenticated')::text, true);

select results_eq(
  $$select connected, channel_title, connected_at from public.youtube_connection_status()$$,
  $$values (false, null::text, null::timestamptz)$$,
  '許可リストから外された A は connected=false の行を受け取る');
select is(public.am_i_allowed(), false, '許可リストから外された A は am_i_allowed() が false');

-- ---------- anon ----------
reset role;
set local role anon;
select throws_ok($$select * from public.youtube_connections$$, '42501', null, 'anon は youtube_connections を読めない');
select throws_ok($$select * from public.youtube_connection_status()$$, '42501', null, 'anon は youtube_connection_status を呼べない');
select throws_ok($$select public.am_i_allowed()$$, '42501', null, 'anon は am_i_allowed を呼べない');

select * from finish();
rollback;
