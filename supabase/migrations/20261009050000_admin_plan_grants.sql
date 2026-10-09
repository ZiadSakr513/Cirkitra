create table if not exists public.admin_plan_grants (
  id uuid primary key default gen_random_uuid(),
  user_id text not null check (length(btrim(user_id)) > 0),
  plan_id text not null check (plan_id in ('maker', 'pro')),
  granted_by text not null check (length(btrim(granted_by)) > 0),
  granted_at timestamptz not null default now(),
  starts_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  revoked_by text,
  internal_note text,
  constraint admin_plan_grants_expiry_check check (expires_at is null or expires_at > starts_at),
  constraint admin_plan_grants_revocation_check check ((revoked_at is null) = (revoked_by is null)),
  constraint admin_plan_grants_note_length_check check (internal_note is null or length(internal_note) <= 1000)
);

create index if not exists admin_plan_grants_user_history_idx
  on public.admin_plan_grants (user_id, granted_at desc);

alter table public.admin_plan_grants enable row level security;
revoke all on public.admin_plan_grants from public, anon, authenticated;
grant all on public.admin_plan_grants to service_role;

create or replace function public.create_admin_plan_grant(
  p_user_id text,
  p_plan_id text,
  p_granted_by text,
  p_expires_at timestamptz,
  p_internal_note text default null
)
returns setof public.admin_plan_grants
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  if p_user_id is null or pg_catalog.btrim(p_user_id) = '' then
    raise exception 'Account ID is required';
  end if;
  if p_granted_by is null or pg_catalog.btrim(p_granted_by) = '' then
    raise exception 'Granting administrator ID is required';
  end if;
  if p_plan_id not in ('maker', 'pro') then
    raise exception 'Plan must be Maker or Pro';
  end if;
  if p_expires_at is not null and p_expires_at <= v_now then
    raise exception 'Grant expiration must be in the future';
  end if;
  if p_internal_note is not null and pg_catalog.length(p_internal_note) > 1000 then
    raise exception 'Grant note is too long';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id, 0));

  update public.admin_plan_grants as grants
    set revoked_at = v_now,
        revoked_by = p_granted_by
    where grants.user_id = p_user_id
      and grants.revoked_at is null
      and grants.starts_at <= v_now
      and (grants.expires_at is null or grants.expires_at > v_now);

  return query
    insert into public.admin_plan_grants (
      user_id, plan_id, granted_by, granted_at, starts_at, expires_at, internal_note
    ) values (
      p_user_id, p_plan_id, p_granted_by, v_now, v_now, p_expires_at,
      nullif(pg_catalog.btrim(p_internal_note), '')
    )
    returning *;
end;
$$;

create or replace function public.revoke_admin_plan_grant(p_grant_id uuid, p_revoked_by text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id text;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  if p_grant_id is null or p_revoked_by is null or pg_catalog.btrim(p_revoked_by) = '' then
    return false;
  end if;

  select grants.user_id into v_user_id
    from public.admin_plan_grants as grants
    where grants.id = p_grant_id;
  if v_user_id is null then
    return false;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_user_id, 0));

  update public.admin_plan_grants as grants
    set revoked_at = v_now,
        revoked_by = p_revoked_by
    where grants.id = p_grant_id
      and grants.revoked_at is null
      and grants.starts_at <= v_now
      and (grants.expires_at is null or grants.expires_at > v_now);

  return found;
end;
$$;

create or replace function public.get_active_plan_entitlements(p_user_id text)
returns table (
  paypal_plan_id text,
  paypal_subscription_id text,
  subscription_status text,
  paid_through timestamptz,
  cancellation_requested_at timestamptz,
  admin_grant_id uuid,
  admin_grant_plan_id text,
  admin_grant_expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_subscription public.paypal_subscriptions%rowtype;
  v_grant public.admin_plan_grants%rowtype;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  if p_user_id is null or pg_catalog.btrim(p_user_id) = '' then
    raise exception 'User ID is required';
  end if;

  select subscriptions.* into v_subscription
    from public.paypal_subscriptions as subscriptions
    where subscriptions.user_id = p_user_id
    order by (subscriptions.successful_payment_at is not null and subscriptions.paid_through > v_now) desc,
      case when subscriptions.plan_id = 'pro' then 0 else 1 end,
      subscriptions.paid_through desc nulls last,
      subscriptions.updated_at desc
    limit 1;

  select grants.* into v_grant
    from public.admin_plan_grants as grants
    where grants.user_id = p_user_id
      and grants.revoked_at is null
      and grants.starts_at <= v_now
      and (grants.expires_at is null or grants.expires_at > v_now)
    order by case when grants.plan_id = 'pro' then 0 else 1 end,
      grants.starts_at desc,
      grants.granted_at desc
    limit 1;

  return query select
    case
      when v_subscription.successful_payment_at is not null and v_subscription.paid_through > v_now
        then v_subscription.plan_id
      else 'free'::text
    end,
    v_subscription.paypal_subscription_id,
    v_subscription.status,
    v_subscription.paid_through,
    v_subscription.cancellation_requested_at,
    v_grant.id,
    v_grant.plan_id,
    v_grant.expires_at;
end;
$$;

create or replace function public.get_active_admin_plan_grant(p_user_id text)
returns table (
  id uuid,
  plan_id text,
  expires_at timestamptz
)
language sql
security definer
set search_path = ''
as $$
  select grants.id, grants.plan_id, grants.expires_at
    from public.admin_plan_grants as grants
    where p_user_id is not null
      and pg_catalog.btrim(p_user_id) <> ''
      and grants.user_id = p_user_id
      and grants.revoked_at is null
      and grants.starts_at <= pg_catalog.clock_timestamp()
      and (grants.expires_at is null or grants.expires_at > pg_catalog.clock_timestamp())
    order by case when grants.plan_id = 'pro' then 0 else 1 end,
      grants.starts_at desc,
      grants.granted_at desc
    limit 1;
$$;

revoke all on function public.create_admin_plan_grant(text, text, text, timestamptz, text) from public, anon, authenticated;
revoke all on function public.revoke_admin_plan_grant(uuid, text) from public, anon, authenticated;
revoke all on function public.get_active_plan_entitlements(text) from public, anon, authenticated;
revoke all on function public.get_active_admin_plan_grant(text) from public, anon, authenticated;
grant execute on function public.create_admin_plan_grant(text, text, text, timestamptz, text) to service_role;
grant execute on function public.revoke_admin_plan_grant(uuid, text) to service_role;
grant execute on function public.get_active_plan_entitlements(text) to service_role;
grant execute on function public.get_active_admin_plan_grant(text) to service_role;

notify pgrst, 'reload schema';
