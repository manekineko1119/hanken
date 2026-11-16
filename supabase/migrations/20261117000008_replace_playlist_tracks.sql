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
  delete from public.playlist_tracks where playlist_id = p_playlist_id;
  insert into public.playlist_tracks (playlist_id, position, title, artist_name, source, is_latest)
  select p_playlist_id, t.position, t.title, t.artist_name, t.source, coalesce(t.is_latest, false)
  from jsonb_to_recordset(coalesce(p_tracks, '[]'::jsonb))
    as t(position int, title text, artist_name text, source text, is_latest boolean);
end;
$$;

revoke execute on function public.replace_playlist_tracks(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.replace_playlist_tracks(uuid, jsonb, jsonb) to authenticated;
