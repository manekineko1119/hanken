-- ライブの記録：ライブの列・設定の表・写真の表と入れ物

-- lives：会場の住所・最寄り駅・メモ類（すべて null 可）
alter table public.lives
  add column venue_address text,
  add column venue_station text,
  add column access_memo text,
  add column last_train_memo text,
  add column afterparty_memo text,
  add column impression text;

-- user_settings：本人の設定（自宅の最寄り駅）
create table public.user_settings (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  home_station text,
  updated_at timestamptz not null default now()
);
create trigger user_settings_set_updated_at before update on public.user_settings
  for each row execute function private.set_updated_at();
alter table public.user_settings enable row level security;

create policy user_settings_select on public.user_settings for select to authenticated
  using (user_id = (select auth.uid()) and (select private.is_allowed()));
create policy user_settings_insert on public.user_settings for insert to authenticated
  with check (user_id = (select auth.uid()) and (select private.is_allowed()));
create policy user_settings_update on public.user_settings for update to authenticated
  using (user_id = (select auth.uid()) and (select private.is_allowed()))
  with check (user_id = (select auth.uid()) and (select private.is_allowed()));

-- live_photos：ライブの写真（実体は Storage の live-photos）
create table public.live_photos (
  id uuid primary key default gen_random_uuid(),
  live_id uuid not null references public.lives(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  storage_path text not null unique,
  position int not null default 0,
  created_at timestamptz not null default now()
);
create index live_photos_live_id_idx on public.live_photos(live_id);
create index live_photos_user_id_idx on public.live_photos(user_id);
alter table public.live_photos enable row level security;

create policy live_photos_select on public.live_photos for select to authenticated
  using (user_id = (select auth.uid()) and (select private.is_allowed()));
-- 親のライブが自分のもので、storage_path が <user_id>/<live_id>/<id>.jpg と同じであること
create policy live_photos_insert on public.live_photos for insert to authenticated
  with check (
    user_id = (select auth.uid()) and (select private.is_allowed())
    and exists (select 1 from public.lives l where l.id = live_id and l.user_id = (select auth.uid()))
    and storage_path = user_id::text || '/' || live_id::text || '/' || id::text || '.jpg'
  );
create policy live_photos_delete on public.live_photos for delete to authenticated
  using (user_id = (select auth.uid()) and (select private.is_allowed()));

-- 1 ライブ 5 枚まで。親の行を for update でロックしてから数える（同時に足されても超えない）。
-- 呼び出した本人の権限で動かす（本人の lives は update ポリシーで for update できる）。
create or replace function private.live_photos_limit()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform 1 from public.lives where id = new.live_id for update;
  if (select count(*) from public.live_photos where live_id = new.live_id) >= 5 then
    raise exception 'PHOTO_LIMIT';
  end if;
  return new;
end;
$$;
create trigger live_photos_limit before insert on public.live_photos
  for each row execute function private.live_photos_limit();

-- Storage の入れ物（非公開・1MiB・jpeg だけ）
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('live-photos', 'live-photos', false, 1048576, array['image/jpeg'])
on conflict (id) do update set public = false, file_size_limit = 1048576, allowed_mime_types = array['image/jpeg'];

-- storage.objects：自分のフォルダ（<user_id>/...）だけ。update は作らない。
create policy live_photos_objects_select on storage.objects for select to authenticated
  using (
    bucket_id = 'live-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and (select private.is_allowed())
  );
create policy live_photos_objects_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'live-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and (select private.is_allowed())
  );
-- 置けるのは、live_photos に本人の行があるパスだけ（行のない写真は置けない＝5 枚を超えて置けない）
create policy live_photos_objects_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'live-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and (select private.is_allowed())
    and exists (
      select 1 from public.live_photos p
      where p.storage_path = objects.name and p.user_id = (select auth.uid())
    )
  );
