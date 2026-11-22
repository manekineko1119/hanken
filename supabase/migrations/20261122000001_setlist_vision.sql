-- セトリ読み取り（Cloud Vision）：月の枚数の数え方と、曲の「自信なし」の列。

-- 月ごとに使った画像の枚数（Cloud Vision は月 1000 枚まで無料。800 で止める）。Edge Function（service role）だけが使う。
create table public.vision_usage (
  month_pt date primary key,
  images int not null default 0
);
alter table public.vision_usage enable row level security;
revoke all on public.vision_usage from anon, authenticated;

-- 読み取りの結果で自信がない曲の印
alter table public.playlist_tracks add column uncertain boolean not null default false;

-- 枚数と回数を先に押さえる。戻り値：'ok'（押さえた）・'month'（月の上限）・'day'（一人の一日の上限）。
-- 月（800 枚）→ 日（10 回）の順に確かめ、どちらも通ったときだけ両方に足す。
create or replace function public.reserve_vision(p_user_id uuid, p_day_jst date, p_month_pt date, p_images int)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  m int;
  d int;
begin
  if p_user_id is null or p_day_jst is null or p_month_pt is null then
    raise exception 'null argument' using errcode = '22004';
  end if;
  if p_images is null or p_images < 1 or p_images > 4 then
    raise exception 'p_images must be 1..4' using errcode = '22023';
  end if;

  -- 今月の行を作ってロックする（同時に来た人は順番に通る）
  insert into public.vision_usage (month_pt) values (p_month_pt) on conflict do nothing;
  select images into m from public.vision_usage where month_pt = p_month_pt for update;
  if m + p_images > 800 then
    return 'month';
  end if;

  select count into d from public.user_daily_usage
  where user_id = p_user_id and day_jst = p_day_jst and kind = 'setlist';
  if coalesce(d, 0) >= 10 then
    return 'day';
  end if;

  update public.vision_usage set images = images + p_images where month_pt = p_month_pt;
  insert into public.user_daily_usage as u (user_id, day_jst, kind, count)
  values (p_user_id, p_day_jst, 'setlist', 1)
  on conflict (user_id, day_jst, kind) do update set count = u.count + 1;
  return 'ok';
end;
$$;

revoke execute on function public.reserve_vision(uuid, date, date, int) from public, anon, authenticated;
grant execute on function public.reserve_vision(uuid, date, date, int) to service_role;

-- 曲の入れ替えで uncertain も入れる（なければ false）。引数の形は変えない。
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
  update public.playlists set candidates = p_candidates, edited_at = now() where id = p_playlist_id;
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
  insert into public.playlist_tracks (playlist_id, position, title, artist_name, source, is_latest, uncertain, video_id, video_title, video_checked_at)
  select p_playlist_id, t.position, t.title, t.artist_name, t.source, coalesce(t.is_latest, false), coalesce(t.uncertain, false),
    k.video_id, k.video_title, k.video_checked_at
  from jsonb_to_recordset(coalesce(p_tracks, '[]'::jsonb))
    as t(position int, title text, artist_name text, source text, is_latest boolean, uncertain boolean)
  left join keep k on k.title = t.title and k.artist_name = t.artist_name;
end;
$$;

revoke execute on function public.replace_playlist_tracks(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.replace_playlist_tracks(uuid, jsonb, jsonb) to authenticated;
