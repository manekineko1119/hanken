-- Edge Functions（service role）だけが使う表。RLS を有効にして、ポリシーは作らない。
create table public.youtube_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  channel_title text,
  refresh_token_enc text,
  access_token_enc text,
  access_expires_at timestamptz,
  connected_at timestamptz not null default now()
);

create table public.oauth_states (
  state text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  code_verifier text not null,
  return_to text,
  expires_at timestamptz not null default (now() + interval '10 minutes')
);
create index oauth_states_user_id_idx on public.oauth_states(user_id);
create index oauth_states_expires_at_idx on public.oauth_states(expires_at);

create table public.track_cache (
  artist_key text primary key,
  payload jsonb not null,
  fetched_at timestamptz not null default now()
);

create table public.video_cache (
  artist_key text not null,
  title_key text not null,
  video_id text,
  video_title text,
  channel_title text,
  fetched_at timestamptz not null default now(),
  primary key (artist_key, title_key)
);
create index video_cache_fetched_at_idx on public.video_cache(fetched_at);

create table public.api_usage (
  day_pt date primary key,
  units int not null default 0,
  searches int not null default 0
);

create table public.user_daily_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  day_jst date not null,
  kind text not null,
  count int not null default 0,
  primary key (user_id, day_jst, kind)
);

alter table public.youtube_connections enable row level security;
alter table public.oauth_states enable row level security;
alter table public.track_cache enable row level security;
alter table public.video_cache enable row level security;
alter table public.api_usage enable row level security;
alter table public.user_daily_usage enable row level security;

revoke all on public.youtube_connections, public.oauth_states, public.track_cache,
  public.video_cache, public.api_usage, public.user_daily_usage from anon, authenticated;

-- ブラウザに YouTube のつながりの状態だけを見せる（鍵は返さない）
create or replace function public.youtube_connection_status()
returns table (connected boolean, channel_title text, connected_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return query
    select true, c.channel_title, c.connected_at
    from public.youtube_connections c
    where c.user_id = (select auth.uid()) and (select private.is_allowed());
  if not found then
    return query select false, null::text, null::timestamptz;
  end if;
end;
$$;
revoke execute on function public.youtube_connection_status() from public, anon;
grant execute on function public.youtube_connection_status() to authenticated;
