begin;
select plan(8);

-- ブラウザ（authenticated）は、YouTube に関わる列を書けない（Edge Function の service role だけが書く）。
-- 書けると、自分の行の youtube_playlist_id を他人のプレイリストの ID に変えて保存させられるため。
select is(has_column_privilege('authenticated', 'public.playlists', 'youtube_playlist_id', 'update'), false, 'youtube_playlist_id は update できない');
select is(has_column_privilege('authenticated', 'public.playlists', 'youtube_playlist_id', 'insert'), false, 'youtube_playlist_id は insert できない');
select is(has_column_privilege('authenticated', 'public.playlists', 'status', 'update'), false, 'status は update できない');
select is(has_column_privilege('authenticated', 'public.playlists', 'saved_at', 'update'), false, 'saved_at は update できない');
select is(has_column_privilege('authenticated', 'public.playlists', 'save_locked_until', 'update'), false, 'save_locked_until は update できない');
-- アプリが使う列は書ける
select is(has_column_privilege('authenticated', 'public.playlists', 'title', 'update'), true, 'title は update できる');
select is(has_column_privilege('authenticated', 'public.playlists', 'candidates', 'insert'), true, 'candidates は insert できる');
select is(has_column_privilege('service_role', 'public.playlists', 'youtube_playlist_id', 'update'), true, 'service_role は youtube_playlist_id を update できる');

select * from finish();
rollback;
