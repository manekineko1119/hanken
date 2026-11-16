-- 30日の決まり（設計 4.5）：毎日 04:00 JST（= 19:00 UTC）に片付ける
create extension if not exists pg_cron;

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
end;
$$;
revoke execute on function private.cleanup_youtube_data() from public, anon, authenticated;

select cron.schedule('liveapp-cleanup', '0 19 * * *', $job$select private.cleanup_youtube_data()$job$);
