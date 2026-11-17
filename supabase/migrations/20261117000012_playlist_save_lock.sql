-- YouTube への保存を、プレイリストごとに1つずつにする（同時に押されても、プレイリストが2つできない）。
-- save_locked_until が未来のあいだは「保存中」。途中で落ちても、時刻を過ぎれば自然に空く。
alter table public.playlists add column save_locked_until timestamptz;

-- 持ち主の行で、鍵が空か期限切れのときだけ、鍵をかけて true を返す。取れなければ false。
create or replace function public.claim_playlist_save(p_playlist_id uuid, p_user_id uuid, p_seconds int)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  n int;
begin
  update public.playlists
    set save_locked_until = now() + make_interval(secs => p_seconds)
  where id = p_playlist_id
    and user_id = p_user_id
    and (save_locked_until is null or save_locked_until <= now());
  get diagnostics n = row_count;
  return n > 0;
end;
$$;

-- 持ち主の行の鍵を外す。
create or replace function public.release_playlist_save(p_playlist_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.playlists set save_locked_until = null
  where id = p_playlist_id and user_id = p_user_id;
end;
$$;

revoke execute on function public.claim_playlist_save(uuid, uuid, int) from public, anon, authenticated;
grant execute on function public.claim_playlist_save(uuid, uuid, int) to service_role;
revoke execute on function public.release_playlist_save(uuid, uuid) from public, anon, authenticated;
grant execute on function public.release_playlist_save(uuid, uuid) to service_role;
