create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  project jsonb not null check (jsonb_typeof(project) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists projects_owner_updated_at_idx
  on public.projects (owner_id, updated_at desc);

create or replace function public.set_project_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists projects_set_updated_at on public.projects;
create trigger projects_set_updated_at
  before update on public.projects
  for each row execute function public.set_project_updated_at();

alter table public.projects enable row level security;
revoke all on table public.projects from anon;
grant select, insert, update, delete on table public.projects to authenticated;

create policy "Users can read their own projects"
  on public.projects for select to authenticated
  using ((select auth.uid()) = owner_id);

create policy "Users can create their own projects"
  on public.projects for insert to authenticated
  with check ((select auth.uid()) = owner_id);

create policy "Users can update their own projects"
  on public.projects for update to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

create policy "Users can delete their own projects"
  on public.projects for delete to authenticated
  using ((select auth.uid()) = owner_id);

create table if not exists public.account_settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  legacy_project_migrated_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.account_settings enable row level security;
revoke all on table public.account_settings from anon;
grant select, insert, update on table public.account_settings to authenticated;

create policy "Users can read their own account settings"
  on public.account_settings for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can create their own account settings"
  on public.account_settings for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Users can update their own account settings"
  on public.account_settings for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
