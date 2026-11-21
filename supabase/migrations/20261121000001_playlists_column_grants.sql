-- YouTube に関わる列（youtube_playlist_id・status・saved_at・save_locked_until）は、
-- Edge Function（service role）だけが書く。ブラウザ（authenticated）からは書けないようにする。
-- 書けると、自分の行の youtube_playlist_id を他人のプレイリストの ID に変えて「保存」させ、
-- その人の YouTube の鍵で中身を消せてしまうため（2026-11-21 のレビュー）。
-- 読むのは今までどおり（RLS で自分の行だけ）。user_id は insert できる列に残す（RLS の確かめが効くように）。
revoke insert, update on public.playlists from anon, authenticated;

grant insert (user_id, kind, live_id, live_artist_id, artist_name, itunes_artist_id, title, candidates)
  on public.playlists to authenticated;
-- title：名前を変える。candidates・edited_at：曲を置き換える関数 replace_playlist_tracks（security invoker）が書く。
grant update (title, candidates, edited_at) on public.playlists to authenticated;
