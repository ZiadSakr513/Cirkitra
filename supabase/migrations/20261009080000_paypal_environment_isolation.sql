-- Keep historical PayPal rows, but isolate Sandbox and Live identities,
-- checkout locks, idempotency, and entitlement lookups.

alter table public.paypal_checkout_intents
  add column if not exists environment text;
update public.paypal_checkout_intents
  set environment = 'sandbox'
  where environment is null;
alter table public.paypal_checkout_intents
  alter column environment set default 'sandbox',
  alter column environment set not null;

alter table public.paypal_subscriptions
  add column if not exists environment text;
update public.paypal_subscriptions
  set environment = 'sandbox'
  where environment is null;
alter table public.paypal_subscriptions
  alter column environment set default 'sandbox',
  alter column environment set not null;

alter table public.paypal_webhook_events
  add column if not exists environment text;
update public.paypal_webhook_events
  set environment = 'sandbox'
  where environment is null;
alter table public.paypal_webhook_events
  alter column environment set default 'sandbox',
  alter column environment set not null;

do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'paypal_checkout_intents_environment_check'
      and conrelid = 'public.paypal_checkout_intents'::regclass
  ) then
    alter table public.paypal_checkout_intents
      add constraint paypal_checkout_intents_environment_check check (environment in ('sandbox', 'live'));
  end if;
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'paypal_subscriptions_environment_check'
      and conrelid = 'public.paypal_subscriptions'::regclass
  ) then
    alter table public.paypal_subscriptions
      add constraint paypal_subscriptions_environment_check check (environment in ('sandbox', 'live'));
  end if;
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'paypal_webhook_events_environment_check'
      and conrelid = 'public.paypal_webhook_events'::regclass
  ) then
    alter table public.paypal_webhook_events
      add constraint paypal_webhook_events_environment_check check (environment in ('sandbox', 'live'));
  end if;
end;
$$;

-- PayPal IDs are unique within an environment, not necessarily across both.
alter table public.paypal_subscriptions drop constraint if exists paypal_subscriptions_pkey;
alter table public.paypal_subscriptions
  add constraint paypal_subscriptions_pkey primary key (environment, paypal_subscription_id);
alter table public.paypal_webhook_events drop constraint if exists paypal_webhook_events_pkey;
alter table public.paypal_webhook_events
  add constraint paypal_webhook_events_pkey primary key (environment, event_id);

create index if not exists paypal_checkout_intents_environment_user_created_idx
  on public.paypal_checkout_intents (environment, user_id, created_at desc);
create index if not exists paypal_subscriptions_environment_user_entitlement_idx
  on public.paypal_subscriptions (environment, user_id, paid_through desc);

create or replace function public.create_paypal_checkout_intent(
  p_user_id text,
  p_plan_id text,
  p_environment text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_intent_id uuid;
  v_intent_plan_id text;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  if p_user_id is null or pg_catalog.btrim(p_user_id) = '' then
    raise exception 'User ID is required';
  end if;
  if p_plan_id is null or p_plan_id not in ('maker', 'pro') then
    raise exception 'PayPal plan ID is invalid';
  end if;
  if p_environment is null or p_environment not in ('sandbox', 'live') then
    raise exception 'PayPal environment is invalid';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_environment || ':' || p_user_id, 1));

  update public.paypal_checkout_intents
    set consumed_at = v_now
    where user_id = p_user_id
      and environment = p_environment
      and consumed_at is null
      and expires_at <= v_now;

  if exists (
    select 1 from public.paypal_subscriptions as subscriptions
    where subscriptions.user_id = p_user_id
      and subscriptions.environment = p_environment
      and subscriptions.successful_payment_at is not null
      and subscriptions.paid_through > v_now
  ) then
    raise exception 'An active paid plan already exists';
  end if;

  if exists (
    select 1 from public.paypal_subscriptions as subscriptions
    where subscriptions.user_id = p_user_id
      and subscriptions.environment = p_environment
      and subscriptions.status in ('APPROVAL_PENDING', 'APPROVED', 'ACTIVE', 'SUSPENDED')
      and subscriptions.cancellation_requested_at is null
  ) then
    raise exception 'An open PayPal subscription already exists';
  end if;

  select intents.id, intents.plan_id into v_intent_id, v_intent_plan_id
    from public.paypal_checkout_intents as intents
    where intents.user_id = p_user_id
      and intents.environment = p_environment
      and intents.consumed_at is null
      and intents.expires_at > v_now
    order by intents.created_at desc
    limit 1;

  if v_intent_id is not null then
    if v_intent_plan_id <> p_plan_id then
      raise exception 'Another PayPal checkout is already in progress';
    end if;
    return v_intent_id;
  end if;

  insert into public.paypal_checkout_intents (user_id, plan_id, environment, expires_at)
    values (p_user_id, p_plan_id, p_environment, v_now + interval '1 hour')
    returning id into v_intent_id;
  return v_intent_id;
end;
$$;

-- Older application servers are confined to Sandbox by these compatibility RPCs.
create or replace function public.create_paypal_checkout_intent(p_user_id text, p_plan_id text)
returns uuid
language sql
security definer
set search_path = ''
as $$
  select public.create_paypal_checkout_intent(p_user_id, p_plan_id, 'sandbox');
$$;

create or replace function public.create_paypal_checkout_intent(p_user_id text)
returns uuid
language sql
security definer
set search_path = ''
as $$
  select public.create_paypal_checkout_intent(p_user_id, 'maker', 'sandbox');
$$;

create or replace function public.apply_paypal_webhook_event(
  p_event_id text,
  p_event_type text,
  p_paypal_subscription_id text,
  p_checkout_intent_id uuid,
  p_subscription_status text,
  p_paid_through timestamptz,
  p_environment text,
  p_payment_succeeded boolean default false,
  p_revoke_entitlement boolean default false
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id text;
  v_plan_id text;
  v_inserted integer;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_subscription_exists boolean;
begin
  if p_event_id is null or pg_catalog.btrim(p_event_id) = ''
     or p_event_type is null or pg_catalog.btrim(p_event_type) = ''
     or p_paypal_subscription_id is null or pg_catalog.btrim(p_paypal_subscription_id) = ''
     or p_checkout_intent_id is null then
    raise exception 'PayPal event identity is incomplete';
  end if;
  if p_environment is null or p_environment not in ('sandbox', 'live') then
    raise exception 'PayPal environment is invalid';
  end if;
  if p_subscription_status is not null and p_subscription_status not in (
    'APPROVAL_PENDING', 'APPROVED', 'ACTIVE', 'SUSPENDED', 'CANCELLED', 'EXPIRED'
  ) then
    raise exception 'PayPal subscription status is invalid';
  end if;
  if p_payment_succeeded and p_paid_through is null then
    raise exception 'A successful payment requires the verified paid-through date';
  end if;

  select intents.user_id, intents.plan_id into v_user_id, v_plan_id
    from public.paypal_checkout_intents as intents
    where intents.id = p_checkout_intent_id
      and intents.environment = p_environment;
  if v_user_id is null or v_plan_id is null or v_plan_id not in ('maker', 'pro') then
    raise exception 'PayPal checkout intent was not found';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_environment || ':' || v_user_id, 1));

  select exists (
    select 1 from public.paypal_subscriptions as subscriptions
    where subscriptions.environment = p_environment
      and subscriptions.paypal_subscription_id = p_paypal_subscription_id
  ) into v_subscription_exists;

  if exists (
    select 1 from public.paypal_subscriptions as subscriptions
    where subscriptions.environment = p_environment
      and subscriptions.checkout_intent_id = p_checkout_intent_id
      and subscriptions.paypal_subscription_id <> p_paypal_subscription_id
  ) then
    raise exception 'PayPal checkout intent is already linked to another subscription';
  end if;

  if not v_subscription_exists and exists (
    select 1 from public.paypal_subscriptions as subscriptions
    where subscriptions.environment = p_environment
      and subscriptions.user_id = v_user_id
      and subscriptions.paypal_subscription_id <> p_paypal_subscription_id
      and (
        (subscriptions.successful_payment_at is not null and subscriptions.paid_through > v_now)
        or subscriptions.status in ('APPROVAL_PENDING', 'APPROVED', 'ACTIVE', 'SUSPENDED')
      )
  ) then
    raise exception 'Another paid plan or PayPal subscription is already active';
  end if;

  if p_payment_succeeded and exists (
    select 1 from public.paypal_subscriptions as subscriptions
    where subscriptions.environment = p_environment
      and subscriptions.user_id = v_user_id
      and subscriptions.paypal_subscription_id <> p_paypal_subscription_id
      and subscriptions.successful_payment_at is not null
      and subscriptions.paid_through > v_now
  ) then
    raise exception 'Another paid entitlement is still active';
  end if;

  insert into public.paypal_webhook_events (event_id, event_type, paypal_subscription_id, environment)
    values (p_event_id, p_event_type, p_paypal_subscription_id, p_environment)
    on conflict (environment, event_id) do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then
    return false;
  end if;

  insert into public.paypal_subscriptions (
    paypal_subscription_id, checkout_intent_id, user_id, plan_id, environment, status,
    successful_payment_at, paid_through, updated_at
  ) values (
    p_paypal_subscription_id, p_checkout_intent_id, v_user_id, v_plan_id, p_environment,
    coalesce(p_subscription_status, 'APPROVAL_PENDING'),
    case when p_payment_succeeded then v_now else null end,
    case when p_payment_succeeded then p_paid_through else null end,
    v_now
  )
  on conflict (environment, paypal_subscription_id) do update set
    status = coalesce(p_subscription_status, paypal_subscriptions.status),
    successful_payment_at = case
      when p_payment_succeeded then coalesce(paypal_subscriptions.successful_payment_at, v_now)
      else paypal_subscriptions.successful_payment_at
    end,
    paid_through = case
      when p_revoke_entitlement then least(coalesce(paypal_subscriptions.paid_through, v_now), v_now)
      when p_payment_succeeded then p_paid_through
      else paypal_subscriptions.paid_through
    end,
    updated_at = v_now
  where paypal_subscriptions.checkout_intent_id = p_checkout_intent_id
    and paypal_subscriptions.user_id = v_user_id
    and paypal_subscriptions.plan_id = v_plan_id;

  if not found then
    raise exception 'PayPal subscription identity or plan does not match its checkout intent';
  end if;

  update public.paypal_checkout_intents
    set consumed_at = coalesce(consumed_at, v_now)
    where id = p_checkout_intent_id
      and environment = p_environment;

  return true;
end;
$$;

-- Old application instances can still process existing Sandbox deliveries only.
create or replace function public.apply_paypal_webhook_event(
  p_event_id text,
  p_event_type text,
  p_paypal_subscription_id text,
  p_checkout_intent_id uuid,
  p_subscription_status text,
  p_paid_through timestamptz,
  p_payment_succeeded boolean default false,
  p_revoke_entitlement boolean default false
)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select public.apply_paypal_webhook_event(
    p_event_id, p_event_type, p_paypal_subscription_id, p_checkout_intent_id,
    p_subscription_status, p_paid_through, 'sandbox', p_payment_succeeded, p_revoke_entitlement
  );
$$;

create or replace function public.get_paypal_plan_entitlement(p_user_id text, p_environment text)
returns table (
  plan_id text,
  paypal_subscription_id text,
  subscription_status text,
  paid_through timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_subscription public.paypal_subscriptions%rowtype;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  if p_user_id is null or pg_catalog.btrim(p_user_id) = '' then
    raise exception 'User ID is required';
  end if;
  if p_environment is null or p_environment not in ('sandbox', 'live') then
    raise exception 'PayPal environment is invalid';
  end if;

  select subscriptions.* into v_subscription
    from public.paypal_subscriptions as subscriptions
    where subscriptions.user_id = p_user_id
      and subscriptions.environment = p_environment
      and subscriptions.successful_payment_at is not null
      and subscriptions.paid_through > v_now
    order by case when subscriptions.plan_id = 'pro' then 0 else 1 end,
      subscriptions.paid_through desc
    limit 1;

  if v_subscription.paypal_subscription_id is null then
    return query select 'free'::text, null::text, null::text, null::timestamptz;
  else
    return query select v_subscription.plan_id, v_subscription.paypal_subscription_id,
      v_subscription.status, v_subscription.paid_through;
  end if;
end;
$$;

create or replace function public.get_paypal_plan_entitlement(p_user_id text)
returns table (
  plan_id text,
  paypal_subscription_id text,
  subscription_status text,
  paid_through timestamptz
)
language sql
security definer
set search_path = ''
as $$
  select * from public.get_paypal_plan_entitlement(p_user_id, 'sandbox');
$$;

create or replace function public.get_paypal_maker_entitlement(p_user_id text, p_environment text)
returns table (
  has_maker boolean,
  paypal_subscription_id text,
  subscription_status text,
  paid_through timestamptz
)
language sql
security definer
set search_path = ''
as $$
  select entitlement.plan_id in ('maker', 'pro'), entitlement.paypal_subscription_id,
    entitlement.subscription_status, entitlement.paid_through
  from public.get_paypal_plan_entitlement(p_user_id, p_environment) as entitlement;
$$;

create or replace function public.get_paypal_maker_entitlement(p_user_id text)
returns table (
  has_maker boolean,
  paypal_subscription_id text,
  subscription_status text,
  paid_through timestamptz
)
language sql
security definer
set search_path = ''
as $$
  select * from public.get_paypal_maker_entitlement(p_user_id, 'sandbox');
$$;

create or replace function public.get_active_plan_entitlements(p_user_id text, p_environment text)
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
  if p_environment is null or p_environment not in ('sandbox', 'live') then
    raise exception 'PayPal environment is invalid';
  end if;

  select subscriptions.* into v_subscription
    from public.paypal_subscriptions as subscriptions
    where subscriptions.user_id = p_user_id
      and subscriptions.environment = p_environment
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
language sql
security definer
set search_path = ''
as $$
  select * from public.get_active_plan_entitlements(p_user_id, 'sandbox');
$$;

revoke all on function public.create_paypal_checkout_intent(text) from public, anon, authenticated;
revoke all on function public.create_paypal_checkout_intent(text, text) from public, anon, authenticated;
revoke all on function public.create_paypal_checkout_intent(text, text, text) from public, anon, authenticated;
revoke all on function public.apply_paypal_webhook_event(text, text, text, uuid, text, timestamptz, boolean, boolean) from public, anon, authenticated;
revoke all on function public.apply_paypal_webhook_event(text, text, text, uuid, text, timestamptz, text, boolean, boolean) from public, anon, authenticated;
revoke all on function public.get_paypal_plan_entitlement(text) from public, anon, authenticated;
revoke all on function public.get_paypal_plan_entitlement(text, text) from public, anon, authenticated;
revoke all on function public.get_paypal_maker_entitlement(text) from public, anon, authenticated;
revoke all on function public.get_paypal_maker_entitlement(text, text) from public, anon, authenticated;
revoke all on function public.get_active_plan_entitlements(text) from public, anon, authenticated;
revoke all on function public.get_active_plan_entitlements(text, text) from public, anon, authenticated;

grant execute on function public.create_paypal_checkout_intent(text) to service_role;
grant execute on function public.create_paypal_checkout_intent(text, text) to service_role;
grant execute on function public.create_paypal_checkout_intent(text, text, text) to service_role;
grant execute on function public.apply_paypal_webhook_event(text, text, text, uuid, text, timestamptz, boolean, boolean) to service_role;
grant execute on function public.apply_paypal_webhook_event(text, text, text, uuid, text, timestamptz, text, boolean, boolean) to service_role;
grant execute on function public.get_paypal_plan_entitlement(text) to service_role;
grant execute on function public.get_paypal_plan_entitlement(text, text) to service_role;
grant execute on function public.get_paypal_maker_entitlement(text) to service_role;
grant execute on function public.get_paypal_maker_entitlement(text, text) to service_role;
grant execute on function public.get_active_plan_entitlements(text) to service_role;
grant execute on function public.get_active_plan_entitlements(text, text) to service_role;

notify pgrst, 'reload schema';
