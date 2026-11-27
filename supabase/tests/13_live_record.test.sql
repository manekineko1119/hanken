begin;
select plan(16);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'a@example.test'),
  ('00000000-0000-0000-0000-0000000000b1', 'b@example.test');
insert into public.allowed_emails (email) values ('a@example.test'), ('b@example.test');
insert into public.lives (id, user_id, date, title) values
  ('11111111-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', '2026-12-01', 'A live 1'),
  ('11111111-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000a1', '2026-12-02', 'A live 2'),
  ('11111111-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b1', '2026-12-03', 'B live');
insert into public.user_settings (user_id, home_station) values
  ('00000000-0000-0000-0000-0000000000b1', 'B station');

-- 4 枚入れておく live 1 と、5 枚入れておく live 2（postgres で直接）
insert into public.live_photos (id, live_id, user_id, storage_path, position)
select ('aaaaaaaa-0000-0000-0000-00000000000' || i)::uuid, '11111111-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-0000000000a1',
  '00000000-0000-0000-0000-0000000000a1/11111111-0000-0000-0000-000000000001/aaaaaaaa-0000-0000-0000-00000000000' || i || '.jpg', i
from generate_series(1, 4) i;
insert into public.live_photos (id, live_id, user_id, storage_path, position)
select ('bbbbbbbb-0000-0000-0000-00000000000' || i)::uuid, '11111111-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-0000000000a1',
  '00000000-0000-0000-0000-0000000000a1/11111111-0000-0000-0000-000000000002/bbbbbbbb-0000-0000-0000-00000000000' || i || '.jpg', i
from generate_series(1, 5) i;

select is((select public from storage.buckets where id = 'live-photos'), false, '入れ物は非公開');
select is((select file_size_limit from storage.buckets where id = 'live-photos'), 1048576::bigint, '入れ物は 1MiB まで');
select is((select allowed_mime_types from storage.buckets where id = 'live-photos'), array['image/jpeg'], '入れ物は jpeg だけ');

-- ---------- A として ----------
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000000a1', 'email', 'a@example.test', 'role', 'authenticated')::text, true);

select lives_ok($$insert into public.user_settings (home_station) values ('A station')$$, '本人は user_settings を足せる');
select lives_ok($$update public.user_settings set home_station = 'A station 2'$$, '本人は user_settings を更新できる');
select is((select count(*)::int from public.user_settings), 1, '見える user_settings は自分の 1 行だけ');
select is((select home_station from public.user_settings), 'A station 2', '更新が読める');

select throws_ok(
  $$insert into public.live_photos (id, live_id, storage_path) values
    ('cccccccc-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', 'wrong/path.jpg')$$,
  '42501', null, 'storage_path が <user_id>/<live_id>/<id>.jpg と違う行は断られる');

select lives_ok(
  $$insert into public.live_photos (id, live_id, storage_path, position) values
    ('aaaaaaaa-0000-0000-0000-000000000005', '11111111-0000-0000-0000-000000000001',
     '00000000-0000-0000-0000-0000000000a1/11111111-0000-0000-0000-000000000001/aaaaaaaa-0000-0000-0000-000000000005.jpg', 5)$$,
  '4 枚あるライブに 5 枚目は足せる');
select throws_ok(
  $$insert into public.live_photos (id, live_id, storage_path, position) values
    ('bbbbbbbb-0000-0000-0000-000000000006', '11111111-0000-0000-0000-000000000002',
     '00000000-0000-0000-0000-0000000000a1/11111111-0000-0000-0000-000000000002/bbbbbbbb-0000-0000-0000-000000000006.jpg', 6)$$,
  'P0001', 'PHOTO_LIMIT', '5 枚あるライブに 6 枚目は PHOTO_LIMIT');
select throws_ok(
  $$insert into public.live_photos (live_id, storage_path) values
    ('11111111-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1/11111111-0000-0000-0000-0000000000b1/x.jpg')$$,
  '42501', null, 'ほかの人のライブには写真を足せない');

-- ---------- B として ----------
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000000b1', 'email', 'b@example.test', 'role', 'authenticated')::text, true);
select is((select count(*)::int from public.live_photos), 0, 'B は A の写真を読めない');
select is((select home_station from public.user_settings), 'B station', 'B は自分の設定だけ読める');

-- ---------- anon ----------
reset role;
set local role anon;
select is((select count(*)::int from public.live_photos), 0, 'anon は live_photos を読めない（0 行）');
select is((select count(*)::int from public.user_settings), 0, 'anon は user_settings を読めない（0 行）');

-- ---------- postgres：ライブを消すと写真も消える ----------
reset role;
delete from public.lives where id = '11111111-0000-0000-0000-000000000002';
select is((select count(*)::int from public.live_photos where live_id = '11111111-0000-0000-0000-000000000002'), 0, 'ライブを消すと写真の行も消える');

select * from finish();
rollback;
