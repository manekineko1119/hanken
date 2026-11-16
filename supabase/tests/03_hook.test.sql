begin;
select plan(11);

insert into public.allowed_emails (email) values ('a@example.test');

-- ---------- フックの中身（postgres で呼ぶ。テスト用の接続は supabase_auth_admin に set role できないため）----------

select is(
  public.hook_before_user_created(jsonb_build_object('user', jsonb_build_object('email', 'stranger@example.test'))) -> 'error' ->> 'http_code',
  '403', '許可リストにないメールは 403');
select is(
  public.hook_before_user_created(jsonb_build_object('user', jsonb_build_object('email', ''))) -> 'error' ->> 'http_code',
  '403', '空のメールは 403');
select is(
  public.hook_before_user_created(jsonb_build_object('user', jsonb_build_object('email', null))) -> 'error' ->> 'http_code',
  '403', 'メールが null でも 403');
select is(
  public.hook_before_user_created('{}'::jsonb) -> 'error' ->> 'http_code',
  '403', 'user がない入力も 403');
select is(
  public.hook_before_user_created(jsonb_build_object('user', jsonb_build_object('email', 'A@Example.Test'))),
  '{}'::jsonb, '大文字のメールは小文字にそろえて一致し {} を返す');
select is(
  public.hook_before_user_created(jsonb_build_object('user', jsonb_build_object('email', ' a@example.test '))),
  '{}'::jsonb, '前後の空白があっても一致し {} を返す');

-- ---------- 権限（Auth が使う supabase_auth_admin だけが実行できる）----------
select ok(has_function_privilege('supabase_auth_admin', 'public.hook_before_user_created(jsonb)', 'execute'), 'supabase_auth_admin は hook を実行できる');
select ok(not has_function_privilege('authenticated', 'public.hook_before_user_created(jsonb)', 'execute'), 'authenticated に execute 権限がない');
select ok(has_table_privilege('supabase_auth_admin', 'public.allowed_emails', 'select'), 'supabase_auth_admin は allowed_emails を select できる');


reset role;
set local role authenticated;
select throws_ok(
  $$select public.hook_before_user_created('{}'::jsonb)$$,
  '42501', null, 'authenticated は hook を実行できない');
reset role;
set local role anon;
select throws_ok(
  $$select public.hook_before_user_created('{}'::jsonb)$$,
  '42501', null, 'anon は hook を実行できない');

select * from finish();
rollback;
