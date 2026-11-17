-- increment_usage を、検索以外（保存など）の回数も数えられるようにする。
-- 変更点：api_usage.searches（YouTube の検索の枠）に足すのは p_kind = 'search' のときだけ。
-- 'save' など別の種類は、一人あたりの回数（user_daily_usage）と単位（units）だけを足す。
create or replace function public.increment_usage(
  p_user_id uuid, p_day_jst date, p_day_pt date, p_kind text, p_searches int, p_units int
)
returns table (user_count int, global_searches int, global_units int)
language plpgsql
security definer
set search_path = ''
as $$
declare
  u int;
  gs int;
  gu int;
  g_delta int := case when p_kind = 'search' then p_searches else 0 end;
begin
  insert into public.user_daily_usage as d (user_id, day_jst, kind, count)
  values (p_user_id, p_day_jst, p_kind, greatest(p_searches, 0))
  on conflict (user_id, day_jst, kind) do update set count = greatest(d.count + p_searches, 0)
  returning d.count into u;

  insert into public.api_usage as a (day_pt, units, searches)
  values (p_day_pt, greatest(p_units, 0), greatest(g_delta, 0))
  on conflict (day_pt) do update
    set units = greatest(a.units + p_units, 0), searches = greatest(a.searches + g_delta, 0)
  returning a.units, a.searches into gu, gs;

  return query select u, gs, gu;
end;
$$;

revoke execute on function public.increment_usage(uuid, date, date, text, int, int) from public, anon, authenticated;
grant execute on function public.increment_usage(uuid, date, date, text, int, int) to service_role;
