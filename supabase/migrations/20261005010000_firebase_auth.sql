-- Firebase Auth uses string UIDs and authenticates requests with a Firebase JWT.
-- Keep existing project rows by converting the old Supabase UUID owner values to text;
-- verified-email linking below replaces legacy values with the corresponding Firebase UID.

-- Policies depend on these columns, so remove them before changing the column types.
drop policy if exists "Users can read their own projects" on public.projects;
drop policy if exists "Users can create their own projects" on public.projects;
drop policy if exists "Users can update their own projects" on public.projects;
drop policy if exists "Users can delete their own projects" on public.projects;

drop policy if exists "Users can read their own account settings" on public.account_settings;
drop policy if exists "Users can create their own account settings" on public.account_settings;
drop policy if exists "Users can update their own account settings" on public.account_settings;

drop index if exists public.projects_owner_updated_at_idx;

alter table public.projects drop constraint if exists projects_owner_id_fkey;
alter table public.projects alter column owner_id type text using owner_id::text;
alter table public.account_settings drop constraint if exists account_settings_user_id_fkey;
alter table public.account_settings alter column user_id type text using user_id::text;

create index projects_owner_updated_at_idx
  on public.projects (owner_id, updated_at desc);

create policy "Users can read their own projects"
  on public.projects for select to authenticated
  using (owner_id = (select auth.jwt() ->> 'sub'));

create policy "Users can create their own projects"
  on public.projects for insert to authenticated
  with check (owner_id = (select auth.jwt() ->> 'sub'));

create policy "Users can update their own projects"
  on public.projects for update to authenticated
  using (owner_id = (select auth.jwt() ->> 'sub'))
  with check (owner_id = (select auth.jwt() ->> 'sub'));

create policy "Users can delete their own projects"
  on public.projects for delete to authenticated
  using (owner_id = (select auth.jwt() ->> 'sub'));

create policy "Users can read their own account settings"
  on public.account_settings for select to authenticated
  using (user_id = (select auth.jwt() ->> 'sub'));

create policy "Users can create their own account settings"
  on public.account_settings for insert to authenticated
  with check (user_id = (select auth.jwt() ->> 'sub'));

create policy "Users can update their own account settings"
  on public.account_settings for update to authenticated
  using (user_id = (select auth.jwt() ->> 'sub'))
  with check (user_id = (select auth.jwt() ->> 'sub'));

create table if not exists public.firebase_auth_links (
  supabase_user_id uuid primary key,
  firebase_uid text not null unique,
  linked_at timestamptz not null default now()
);

alter table public.firebase_auth_links enable row level security;
revoke all on table public.firebase_auth_links from public, anon, authenticated;
grant all on table public.firebase_auth_links to service_role;

create or replace function public.link_legacy_supabase_account(p_firebase_uid text, p_email text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  legacy_user_id uuid;
  linked_firebase_uid text;
  linked_supabase_user_id uuid;
begin
  if p_firebase_uid is null or pg_catalog.btrim(p_firebase_uid) = ''
    or p_email is null or pg_catalog.btrim(p_email) = '' then
    raise exception 'Firebase UID and verified email are required';
  end if;

  select users.id into legacy_user_id
  from auth.users as users
  where pg_catalog.lower(users.email) = pg_catalog.lower(pg_catalog.btrim(p_email))
  limit 1
  for update;

  if legacy_user_id is null then
    return false;
  end if;

  select links.firebase_uid into linked_firebase_uid
  from public.firebase_auth_links as links
  where links.supabase_user_id = legacy_user_id;
  if linked_firebase_uid is not null and linked_firebase_uid <> p_firebase_uid then
    raise exception 'This legacy account is already linked to a different Firebase account';
  end if;

  select links.supabase_user_id into linked_supabase_user_id
  from public.firebase_auth_links as links
  where links.firebase_uid = p_firebase_uid;
  if linked_supabase_user_id is not null and linked_supabase_user_id <> legacy_user_id then
    raise exception 'This Firebase account is already linked to a different legacy account';
  end if;

  insert into public.firebase_auth_links (supabase_user_id, firebase_uid)
  values (legacy_user_id, p_firebase_uid)
  on conflict (supabase_user_id) do nothing;

  update public.projects
  set owner_id = p_firebase_uid
  where owner_id = legacy_user_id::text;

  update public.account_settings
  set user_id = p_firebase_uid
  where user_id = legacy_user_id::text;

  return true;
end;
$$;

revoke all on function public.link_legacy_supabase_account(text, text) from public, anon, authenticated;
grant execute on function public.link_legacy_supabase_account(text, text) to service_role;
