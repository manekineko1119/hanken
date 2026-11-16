begin;
select plan(33);

-- ---------- 準備（postgres）----------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'a@example.test'),
  ('00000000-0000-0000-0000-0000000000b1', 'b@example.test');
insert into public.allowed_emails (email) values ('a@example.test'), ('b@example.test');

insert into public.lives (id, user_id, date, title) values
  ('11111111-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', '2026-12-01', 'A live 1'),
  ('11111111-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000a1', '2026-12-02', 'A live 2');
insert into public.live_artists (id, live_id, user_id, name) values
  ('22222222-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', 'A artist 1'),
  ('22222222-0000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000a1', 'A artist 2');
insert into public.playlists (id, user_id, kind, live_id, live_artist_id, artist_name, title) values
  ('33333333-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', 'setlist',
   '11111111-0000-0000-0000-000000000001', '22222222-0000-0000-0000-000000000001', 'A artist 1', 'A playlist');
insert into public.playlist_tracks (id, playlist_id, user_id, title, artist_name) values
  ('44444444-0000-0000-0000-000000000001', '33333333-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', 'A track', 'A artist 1');

-- B 自身のデータ（B が自分の行だけ見える・触れることの確認用）
insert into public.lives (id, user_id, date, title) values
  ('11111111-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b1', '2026-12-03', 'B live');
insert into public.live_artists (id, live_id, user_id, name) values
  ('22222222-0000-0000-0000-0000000000b1', '11111111-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b1', 'B artist');
insert into public.playlists (id, user_id, kind, live_id, live_artist_id, artist_name, title) values
  ('33333333-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b1', 'setlist',
   '11111111-0000-0000-0000-0000000000b1', '22222222-0000-0000-0000-0000000000b1', 'B artist', 'B playlist');
insert into public.playlist_tracks (id, playlist_id, user_id, title, artist_name) values
  ('44444444-0000-0000-0000-0000000000b1', '33333333-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b1', 'B track', 'B artist');

-- ---------- CHECK 制約（postgres）----------
select throws_ok(
  $$insert into public.playlist_tracks (playlist_id, user_id, title, artist_name, video_id)
    values ('33333333-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', 't', 'x', 'vid')$$,
  '23514', null, 'video_id があるのに video_checked_at が null の曲は入れられない');
select lives_ok(
  $$insert into public.playlist_tracks (playlist_id, user_id, title, artist_name, video_id, video_checked_at)
    values ('33333333-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', 't2', 'x', 'vid', now())$$,
  'video_id と video_checked_at の両方があれば入れられる');
select lives_ok(
  $$insert into public.playlist_tracks (playlist_id, user_id, title, artist_name)
    values ('33333333-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', 't3', 'x')$$,
  'video_id が null なら video_checked_at が null でもよい');

-- ---------- B として ----------
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000000b1', 'email', 'b@example.test', 'role', 'authenticated')::text, true);

select results_eq($$select id from public.lives$$, $$values ('11111111-0000-0000-0000-0000000000b1'::uuid)$$, 'B は lives で自分の行だけ見える（A の行は見えない）');
select results_eq($$select id from public.live_artists$$, $$values ('22222222-0000-0000-0000-0000000000b1'::uuid)$$, 'B は live_artists で自分の行だけ見える（A の行は見えない）');
select results_eq($$select id from public.playlists$$, $$values ('33333333-0000-0000-0000-0000000000b1'::uuid)$$, 'B は playlists で自分の行だけ見える（A の行は見えない）');
select results_eq($$select id from public.playlist_tracks$$, $$values ('44444444-0000-0000-0000-0000000000b1'::uuid)$$, 'B は playlist_tracks で自分の行だけ見える（A の行は見えない）');

select results_eq($$with u as (update public.lives set title = 'edited' returning id) select id from u$$, $$values ('11111111-0000-0000-0000-0000000000b1'::uuid)$$, 'B の update は B 自身の lives の行だけに効く');
select results_eq($$with u as (update public.live_artists set name = 'edited' returning id) select id from u$$, $$values ('22222222-0000-0000-0000-0000000000b1'::uuid)$$, 'B の update は B 自身の live_artists の行だけに効く');
select results_eq($$with u as (update public.playlists set title = 'edited' returning id) select id from u$$, $$values ('33333333-0000-0000-0000-0000000000b1'::uuid)$$, 'B の update は B 自身の playlists の行だけに効く');
select results_eq($$with u as (update public.playlist_tracks set title = 'edited' returning id) select id from u$$, $$values ('44444444-0000-0000-0000-0000000000b1'::uuid)$$, 'B の update は B 自身の playlist_tracks の行だけに効く');

select results_eq($$with d as (delete from public.playlist_tracks returning id) select id from d$$, $$values ('44444444-0000-0000-0000-0000000000b1'::uuid)$$, 'B の delete は B 自身の playlist_tracks の行だけに効く');
select results_eq($$with d as (delete from public.playlists returning id) select id from d$$, $$values ('33333333-0000-0000-0000-0000000000b1'::uuid)$$, 'B の delete は B 自身の playlists の行だけに効く');
select results_eq($$with d as (delete from public.live_artists returning id) select id from d$$, $$values ('22222222-0000-0000-0000-0000000000b1'::uuid)$$, 'B の delete は B 自身の live_artists の行だけに効く');
select results_eq($$with d as (delete from public.lives returning id) select id from d$$, $$values ('11111111-0000-0000-0000-0000000000b1'::uuid)$$, 'B の delete は B 自身の lives の行だけに効く');

select throws_ok(
  $$insert into public.lives (user_id, date) values ('00000000-0000-0000-0000-0000000000a1', '2026-12-31')$$,
  '42501', null, 'B は A の user_id で lives を作れない');
select throws_ok(
  $$insert into public.playlists (user_id, kind, artist_name, title) values ('00000000-0000-0000-0000-0000000000a1', 'prep', 'x', 'x')$$,
  '42501', null, 'B は A の user_id で playlists を作れない');
select throws_ok(
  $$insert into public.live_artists (live_id, user_id, name) values ('11111111-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000b1', 'x')$$,
  '42501', null, 'B は自分の user_id でも A の live に live_artists をぶら下げられない');
select throws_ok(
  $$insert into public.playlist_tracks (playlist_id, user_id, title, artist_name) values ('33333333-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000b1', 'x', 'x')$$,
  '42501', null, 'B は A の playlist に曲をぶら下げられない');
select throws_ok(
  $$insert into public.live_artists (live_id, user_id, name) values ('11111111-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', 'x')$$,
  '42501', null, 'B は A の user_id で live_artists を作れない');
select throws_ok(
  $$insert into public.playlist_tracks (playlist_id, user_id, title, artist_name) values ('33333333-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', 'x', 'x')$$,
  '42501', null, 'B は A の user_id で playlist_tracks を作れない');

-- ---------- A として ----------
reset role;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000000a1', 'email', 'a@example.test', 'role', 'authenticated')::text, true);

select is((select count(*)::int from public.lives), 2, 'A は自分の lives を見られる');
select is((select count(*)::int from public.playlist_tracks), 3, 'A は自分の playlist_tracks を見られる');

select throws_ok(
  $$insert into public.lives (user_id, date) values ('00000000-0000-0000-0000-0000000000b1', '2026-12-31')$$,
  '42501', null, 'A は B の user_id で insert できない');

-- 別の live の live_artist を指す playlist は拒否
select throws_ok(
  $$insert into public.playlists (kind, live_id, live_artist_id, artist_name, title)
    values ('prep', '11111111-0000-0000-0000-000000000001', '22222222-0000-0000-0000-000000000002', 'x', 'x')$$,
  '42501', null, '別の live の live_artist を指す playlist は insert できない');
select throws_ok(
  $$update public.playlists set live_artist_id = '22222222-0000-0000-0000-000000000002' where id = '33333333-0000-0000-0000-000000000001'$$,
  '42501', null, '別の live の live_artist を指すように playlist を update できない');
select lives_ok(
  $$insert into public.playlists (kind, live_id, live_artist_id, artist_name, title)
    values ('prep', '11111111-0000-0000-0000-000000000002', '22222222-0000-0000-0000-000000000002', 'x', 'x')$$,
  '同じ live の live_artist を指す playlist は insert できる');
select lives_ok(
  $$insert into public.playlists (kind, live_id, artist_name, title)
    values ('prep', '11111111-0000-0000-0000-000000000001', 'x', 'x')$$,
  'live_artist が null の playlist は insert できる');

select results_eq(
  $$with u as (update public.lives set title = 'edited' where id = '11111111-0000-0000-0000-000000000001' returning 1) select count(*)::int from u$$,
  $$values (1)$$,
  'A は自分の live を更新できる');

-- ---------- A を許可リストから外す ----------
reset role;
delete from public.allowed_emails where email = 'a@example.test';
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000000a1', 'email', 'a@example.test', 'role', 'authenticated')::text, true);

select is_empty($$select * from public.lives$$, '許可リストから外された A は lives が0行');
select is_empty($$select * from public.live_artists$$, '許可リストから外された A は live_artists が0行');
select is_empty($$select * from public.playlists$$, '許可リストから外された A は playlists が0行');
select is_empty($$select * from public.playlist_tracks$$, '許可リストから外された A は playlist_tracks が0行');

select * from finish();
rollback;
