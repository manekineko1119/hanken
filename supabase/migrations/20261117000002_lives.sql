-- 共通：updated_at を更新するトリガー関数
create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- lives
create table public.lives (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  date date not null,
  venue text,
  title text,
  memo text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index lives_user_id_idx on public.lives(user_id);
create trigger lives_set_updated_at before update on public.lives
  for each row execute function private.set_updated_at();

-- live_artists
create table public.live_artists (
  id uuid primary key default gen_random_uuid(),
  live_id uuid not null references public.lives(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  itunes_artist_id bigint,
  position int
);
create index live_artists_live_id_idx on public.live_artists(live_id);
create index live_artists_user_id_idx on public.live_artists(user_id);

-- RLS
alter table public.lives enable row level security;
alter table public.live_artists enable row level security;

create policy lives_select on public.lives for select to authenticated
  using (user_id = (select auth.uid()) and (select private.is_allowed()));
create policy lives_insert on public.lives for insert to authenticated
  with check (user_id = (select auth.uid()) and (select private.is_allowed()));
create policy lives_update on public.lives for update to authenticated
  using (user_id = (select auth.uid()) and (select private.is_allowed()))
  with check (user_id = (select auth.uid()) and (select private.is_allowed()));
create policy lives_delete on public.lives for delete to authenticated
  using (user_id = (select auth.uid()) and (select private.is_allowed()));

-- live_artists：親の live が自分のものであることも確かめる
create policy live_artists_select on public.live_artists for select to authenticated
  using (user_id = (select auth.uid()) and (select private.is_allowed()));
create policy live_artists_insert on public.live_artists for insert to authenticated
  with check (
    user_id = (select auth.uid()) and (select private.is_allowed())
    and exists (select 1 from public.lives l where l.id = live_id and l.user_id = (select auth.uid()))
  );
create policy live_artists_update on public.live_artists for update to authenticated
  using (user_id = (select auth.uid()) and (select private.is_allowed()))
  with check (
    user_id = (select auth.uid()) and (select private.is_allowed())
    and exists (select 1 from public.lives l where l.id = live_id and l.user_id = (select auth.uid()))
  );
create policy live_artists_delete on public.live_artists for delete to authenticated
  using (user_id = (select auth.uid()) and (select private.is_allowed()));
