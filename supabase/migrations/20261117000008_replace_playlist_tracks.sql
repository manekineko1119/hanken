-- プレイリストの曲を、1つのトランザクションで丸ごと入れ替える（途中で失敗しても元のまま）。
-- security invoker：RLS が効く（他人のプレイリストは見えないので、例外になる）。
create or replace function public.replace_playlist_tracks(p_playlist_id uuid, p_tracks jsonb, p_candidates jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not exists (select 1 from public.playlists where id = p_playlist_id) then
    raise exception 'playlist not found' using errcode = 'P0002';
  end if;
  update public.playlists set candidates = p_candidates where id = p_playlist_id;
  -- 入れ替えても、同じ曲（曲名とアーティスト名が同じ）の動画の割り当ては引き継ぐ。
  -- 同じ曲が複数あれば、動画があるものを優先し、順番の早い方を使う。
  with old as (
    delete from public.playlist_tracks
    where playlist_id = p_playlist_id
    returning position, title, artist_name, video_id, video_title, video_checked_at
  ), keep as (
    select distinct on (title, artist_name) title, artist_name, video_id, video_title, video_checked_at
    from old
    order by title, artist_name, (video_id is null), position
  )
  insert into public.playlist_tracks (playlist_id, position, title, artist_name, source, is_latest, video_id, video_title, video_checked_at)
  select p_playlist_id, t.position, t.title, t.artist_name, t.source, coalesce(t.is_latest, false),
    k.video_id, k.video_title, k.video_checked_at
  from jsonb_to_recordset(coalesce(p_tracks, '[]'::jsonb))
    as t(position int, title text, artist_name text, source text, is_latest boolean)
  left join keep k on k.title = t.title and k.artist_name = t.artist_name;
end;
$$;

revoke execute on function public.replace_playlist_tracks(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.replace_playlist_tracks(uuid, jsonb, jsonb) to authenticated;
