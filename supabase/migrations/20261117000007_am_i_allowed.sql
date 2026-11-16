-- アプリが「ログイン後に許可リストへ入っているか」を確かめるための関数。
-- Before User Created hook は作成時にしか効かないので、あとから外された人はここで止める。
create or replace function public.am_i_allowed()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_allowed()
$$;

revoke execute on function public.am_i_allowed() from public, anon;
grant execute on function public.am_i_allowed() to authenticated;
