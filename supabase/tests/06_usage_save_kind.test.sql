begin;
select plan(5);

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000a1', 'a@example.test');

set local role service_role;
select results_eq($$select * from public.increment_usage('00000000-0000-0000-0000-0000000000a1', '2026-11-17', '2026-11-16', 'save', 1, 0)$$,
  $$values (1, 0, 0)$$, 'save：本人は1、検索の枠は増えない');
select results_eq($$select * from public.increment_usage('00000000-0000-0000-0000-0000000000a1', '2026-11-17', '2026-11-16', 'save', 0, 150)$$,
  $$values (1, 0, 150)$$, 'save：単位だけ足せる');
select results_eq($$select * from public.increment_usage('00000000-0000-0000-0000-0000000000a1', '2026-11-17', '2026-11-16', 'save', 0, -100)$$,
  $$values (1, 0, 50)$$, '単位は引ける');
select results_eq($$select * from public.increment_usage('00000000-0000-0000-0000-0000000000a1', '2026-11-17', '2026-11-16', 'search', 1, 0)$$,
  $$values (1, 1, 50)$$, 'search は種類ごとに別に数え、検索の枠は増える');
select results_eq($$select * from public.increment_usage('00000000-0000-0000-0000-0000000000a1', '2026-11-17', '2026-11-16', 'save', -1, 0)$$,
  $$values (0, 1, 50)$$, 'save の回数を戻せる');

select * from finish();
rollback;
