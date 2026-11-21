-- YouTube とつなぐ途中の鍵（Google から戻ったあと、アプリで確定するまでの10分だけ置く）。
-- callback は JWT なしで呼ばれるので、ここに置くだけにする。ログイン中のアプリが yt-connect-finish で
-- 始めた人と同じ人だと確かめてから youtube_connections に移す（2026-11-21 のレビュー）。
-- Edge Functions（service role）だけが使う。RLS を有効にして、ポリシーは作らない。
create table public.youtube_pending (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  channel_title text,
  refresh_token_enc text not null,
  access_token_enc text not null,
  access_expires_at timestamptz,
  return_to text,
  expires_at timestamptz not null default (now() + interval '10 minutes')
);
create index youtube_pending_expires_at_idx on public.youtube_pending(expires_at);

alter table public.youtube_pending enable row level security;
revoke all on public.youtube_pending from anon, authenticated;

-- 毎日の片付けで、期限の切れた保留も消す（中身は 20261117000006 と同じ。最後の1行を足した）。
create or replace function private.cleanup_youtube_data()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.video_cache where fetched_at < now() - interval '30 days';

  update public.playlist_tracks
     set video_id = null, video_title = null
   where video_checked_at < now() - interval '60 days'
     and (video_id is not null or video_title is not null);

  delete from public.oauth_states where expires_at < now();
  delete from public.youtube_pending where expires_at < now();
end;
$$;
revoke execute on function private.cleanup_youtube_data() from public, anon, authenticated;
