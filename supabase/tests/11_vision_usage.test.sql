begin;
select plan(18);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'a@example.test'),
  ('00000000-0000-0000-0000-0000000000b1', 'b@example.test');

set local role service_role;

-- 月の上限：799 枚に 2 枚は足せない（何も変わらない）
reset role;
insert into public.vision_usage (month_pt, images) values ('2000-01-01', 799);
set local role service_role;
select is(public.reserve_vision('00000000-0000-0000-0000-0000000000a1', '2000-01-02', '2000-01-01', 2), 'month', '月の上限を超えるなら month');
select is((select images from public.vision_usage where month_pt = '2000-01-01'), 799, 'month のとき枚数は変わらない');
select is((select count(*)::int from public.user_daily_usage where user_id = '00000000-0000-0000-0000-0000000000a1' and day_jst = '2000-01-02'), 0, 'month のとき日の回数は増えない');

-- 1 枚なら 800 ちょうどまで入る
select is(public.reserve_vision('00000000-0000-0000-0000-0000000000a1', '2000-01-02', '2000-01-01', 1), 'ok', '1 枚なら ok');
select is((select images from public.vision_usage where month_pt = '2000-01-01'), 800, '枚数が 800 になる');
select is((select count from public.user_daily_usage where user_id = '00000000-0000-0000-0000-0000000000a1' and day_jst = '2000-01-02' and kind = 'setlist'), 1, '日の回数が 1 になる');

-- 新しい月：行ができて 4
select is(public.reserve_vision('00000000-0000-0000-0000-0000000000b1', '2000-02-02', '2000-02-01', 4), 'ok', '新しい月は 4 枚でも ok');
select is((select images from public.vision_usage where month_pt = '2000-02-01'), 4, '新しい月の行が 4 になる');

-- 日の上限：10 回の人は day、何も増えない
reset role;
insert into public.user_daily_usage (user_id, day_jst, kind, count) values ('00000000-0000-0000-0000-0000000000a1', '2000-03-02', 'setlist', 10);
set local role service_role;
select is(public.reserve_vision('00000000-0000-0000-0000-0000000000a1', '2000-03-02', '2000-03-01', 1), 'day', '今日 10 回なら day');
select is((select count from public.user_daily_usage where user_id = '00000000-0000-0000-0000-0000000000a1' and day_jst = '2000-03-02' and kind = 'setlist'), 10, 'day のとき回数は 10 のまま');
select is((select coalesce(sum(images), 0)::int from public.vision_usage where month_pt = '2000-03-01'), 0, 'day のとき枚数は増えない');

-- 9 回なら ok で 10 になる
reset role;
update public.user_daily_usage set count = 9 where user_id = '00000000-0000-0000-0000-0000000000a1' and day_jst = '2000-03-02' and kind = 'setlist';
set local role service_role;
select is(public.reserve_vision('00000000-0000-0000-0000-0000000000a1', '2000-03-02', '2000-03-01', 1), 'ok', '9 回なら ok');
select is((select count from public.user_daily_usage where user_id = '00000000-0000-0000-0000-0000000000a1' and day_jst = '2000-03-02' and kind = 'setlist'), 10, '10 回になる');

-- 枚数の範囲：0・5・null は例外
select throws_ok($$select public.reserve_vision('00000000-0000-0000-0000-0000000000a1', '2000-04-02', '2000-04-01', 0)$$, null, null, '0 枚は例外');
select throws_ok($$select public.reserve_vision('00000000-0000-0000-0000-0000000000a1', '2000-04-02', '2000-04-01', 5)$$, null, null, '5 枚は例外');
select throws_ok($$select public.reserve_vision('00000000-0000-0000-0000-0000000000a1', '2000-04-02', '2000-04-01', null)$$, null, null, 'null は例外');

-- authenticated は実行も読み取りもできない
reset role;
set local role authenticated;
select throws_ok($$select public.reserve_vision('00000000-0000-0000-0000-0000000000a1', '2000-05-02', '2000-05-01', 1)$$, '42501', null, 'authenticated は実行できない');

select throws_ok($$select * from public.vision_usage$$, '42501', null, 'authenticated は vision_usage を読めない');

select * from finish();
rollback;
