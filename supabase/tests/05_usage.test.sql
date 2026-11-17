begin;
select plan(7);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'a@example.test'),
  ('00000000-0000-0000-0000-0000000000b1', 'b@example.test');

-- authenticated・anon は実行できない
set local role authenticated;
select throws_ok($$select * from public.increment_usage('00000000-0000-0000-0000-0000000000a1', '2000-01-01', '2000-01-01', 'search', 1, 0)$$,
  '42501', null, 'authenticated は実行できない');
reset role;
set local role anon;
select throws_ok($$select * from public.increment_usage('00000000-0000-0000-0000-0000000000a1', '2000-01-01', '2000-01-01', 'search', 1, 0)$$,
  '42501', null, 'anon は実行できない');
reset role;

-- service role：足し算が積み上がる
set local role service_role;
select results_eq($$select * from public.increment_usage('00000000-0000-0000-0000-0000000000a1', '2000-01-01', '2000-01-01', 'search', 1, 0)$$,
  $$values (1, 1, 0)$$, '1回目：本人1・全体1');
select results_eq($$select * from public.increment_usage('00000000-0000-0000-0000-0000000000a1', '2000-01-01', '2000-01-01', 'search', 1, 0)$$,
  $$values (2, 2, 0)$$, '2回目：足される');
select results_eq($$select * from public.increment_usage('00000000-0000-0000-0000-0000000000a1', '2000-01-01', '2000-01-01', 'search', 0, 1)$$,
  $$values (2, 2, 1)$$, '単位だけ足しても、検索の回数は変わらない');
select results_eq($$select * from public.increment_usage('00000000-0000-0000-0000-0000000000a1', '2000-01-01', '2000-01-01', 'search', -1, 0)$$,
  $$values (1, 1, 1)$$, '-1 で戻せる');
select results_eq($$select * from public.increment_usage('00000000-0000-0000-0000-0000000000b1', '2000-01-01', '2000-01-01', 'search', 1, 0)$$,
  $$values (1, 2, 1)$$, '別の人：本人は1から、全体は足される');

select * from finish();
rollback;
