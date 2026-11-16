-- 招待制：Before User Created Hook（設計 5.2）
-- allowed_emails 表と private.is_allowed() は 20261117000001 で作成済み。

create or replace function public.hook_before_user_created(event jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_email text;
begin
  v_email := lower(trim(coalesce(event -> 'user' ->> 'email', '')));
  if v_email = '' or not exists (
    select 1 from public.allowed_emails where email = v_email
  ) then
    return jsonb_build_object(
      'error', jsonb_build_object(
        'http_code', 403,
        'message', '招待されていないアカウントです'
      )
    );
  end if;
  return '{}'::jsonb;
end;
$$;

grant execute on function public.hook_before_user_created(jsonb) to supabase_auth_admin;
revoke execute on function public.hook_before_user_created(jsonb) from public, anon, authenticated;

grant select on public.allowed_emails to supabase_auth_admin;
create policy allowed_emails_auth_admin_select on public.allowed_emails
  for select to supabase_auth_admin using (true);
