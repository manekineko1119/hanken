create table public.playlists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind text not null check (kind in ('prep', 'setlist')),
  live_id uuid references public.lives(id) on delete cascade,
  live_artist_id uuid references public.live_artists(id) on delete cascade,
  artist_name text not null,
  itunes_artist_id bigint,
  title text not null,
  status text not null default 'draft' check (status in ('draft', 'saved')),
  youtube_playlist_id text,
  saved_at timestamptz,
  candidates jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint playlists_setlist_requires_live_artist check (kind <> 'setlist' or live_artist_id is not null),
  constraint playlists_live_artist_kind_key unique (live_artist_id, kind)
);
create index playlists_user_id_idx on public.playlists(user_id);
create index playlists_live_id_idx on public.playlists(live_id);
create index playlists_live_artist_id_idx on public.playlists(live_artist_id);
create trigger playlists_set_updated_at before update on public.playlists
  for each row execute function private.set_updated_at();

create table public.playlist_tracks (
  id uuid primary key default gen_random_uuid(),
  playlist_id uuid not null references public.playlists(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  position int,
  title text not null,
  artist_name text not null,
  source text check (source in ('lastfm', 'itunes', 'manual', 'setlist')),
  is_latest boolean not null default false,
  video_id text,
  video_title text,
  video_checked_at timestamptz,
  constraint playlist_tracks_video_checked check (video_id is null or video_checked_at is not null)
);
create index playlist_tracks_user_id_idx on public.playlist_tracks(user_id);
create index playlist_tracks_playlist_id_idx on public.playlist_tracks(playlist_id);
create index playlist_tracks_video_checked_at_idx on public.playlist_tracks(video_checked_at)
  where video_id is not null;

alter table public.playlists enable row level security;
alter table public.playlist_tracks enable row level security;

-- playlists：参照する live / live_artist が自分のものであることも確かめる
create policy playlists_select on public.playlists for select to authenticated
  using (user_id = (select auth.uid()) and (select private.is_allowed()));
create policy playlists_insert on public.playlists for insert to authenticated
  with check (
    user_id = (select auth.uid()) and (select private.is_allowed())
    and (live_id is null or exists (select 1 from public.lives l where l.id = live_id and l.user_id = (select auth.uid())))
    and (live_artist_id is null or exists (select 1 from public.live_artists a where a.id = live_artist_id and a.user_id = (select auth.uid())
      and (playlists.live_id is null or a.live_id = playlists.live_id)))
  );
create policy playlists_update on public.playlists for update to authenticated
  using (user_id = (select auth.uid()) and (select private.is_allowed()))
  with check (
    user_id = (select auth.uid()) and (select private.is_allowed())
    and (live_id is null or exists (select 1 from public.lives l where l.id = live_id and l.user_id = (select auth.uid())))
    and (live_artist_id is null or exists (select 1 from public.live_artists a where a.id = live_artist_id and a.user_id = (select auth.uid())
      and (playlists.live_id is null or a.live_id = playlists.live_id)))
  );
create policy playlists_delete on public.playlists for delete to authenticated
  using (user_id = (select auth.uid()) and (select private.is_allowed()));

-- playlist_tracks：親の playlist が自分のものであることも確かめる
create policy playlist_tracks_select on public.playlist_tracks for select to authenticated
  using (user_id = (select auth.uid()) and (select private.is_allowed()));
create policy playlist_tracks_insert on public.playlist_tracks for insert to authenticated
  with check (
    user_id = (select auth.uid()) and (select private.is_allowed())
    and exists (select 1 from public.playlists p where p.id = playlist_id and p.user_id = (select auth.uid()))
  );
create policy playlist_tracks_update on public.playlist_tracks for update to authenticated
  using (user_id = (select auth.uid()) and (select private.is_allowed()))
  with check (
    user_id = (select auth.uid()) and (select private.is_allowed())
    and exists (select 1 from public.playlists p where p.id = playlist_id and p.user_id = (select auth.uid()))
  );
create policy playlist_tracks_delete on public.playlist_tracks for delete to authenticated
  using (user_id = (select auth.uid()) and (select private.is_allowed()));
