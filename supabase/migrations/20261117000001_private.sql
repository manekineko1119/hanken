-- private スキーマ：RLS から呼ぶ内部関数の置き場所（ブラウザの API には公開しない）
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

-- 許可リスト（招待した人のメール）。後続の RLS が private.is_allowed() を使うので、ここで先に作る。
-- 実在のメールはここに書かない（公開リポジトリ）。
create table public.allowed_emails (
  email text primary key check (email = lower(email)),
  note text,
  created_at timestamptz not null default now()
);
alter table public.allowed_emails enable row level security;
-- anon / authenticated 用のポリシーは作らない。
revoke all on public.allowed_emails from anon, authenticated;

-- 自分のメールが許可リストにあるか（設計 5.2）
create or replace function private.is_allowed()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.allowed_emails
    where email = lower(trim(auth.jwt() ->> 'email'))
  );
$$;
revoke execute on function private.is_allowed() from public, anon;
grant execute on function private.is_allowed() to authenticated;
