-- Add Pro without changing existing Maker subscriptions. The internal plan ID
-- is stored on both the intent and subscription, and all paid entitlement
-- transitions are serialized per Cirkitra user.

alter table public.paypal_checkout_intents
  add column if not exists plan_id text;

update public.paypal_checkout_intents
  set plan_id = 'maker'
  where plan_id is null;

alter table public.paypal_checkout_intents
  alter column plan_id set default 'maker',
  alter column plan_id set not null;

do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'paypal_checkout_intents_plan_id_check'
      and conrelid = 'public.paypal_checkout_intents'::regclass
  ) then
    alter table public.paypal_checkout_intents
      add constraint paypal_checkout_intents_plan_id_check check (plan_id in ('maker', 'pro'));
  end if;
end;
$$;

alter table public.paypal_subscriptions
  add column if not exists plan_id text;

update public.paypal_subscriptions as subscriptions
  set plan_id = coalesce(intents.plan_id, 'maker')
  from public.paypal_checkout_intents as intents
  where intents.id = subscriptions.checkout_intent_id
    and subscriptions.plan_id is null;

update public.paypal_subscriptions
  set plan_id = 'maker'
  where plan_id is null;

alter table public.paypal_subscriptions
  alter column plan_id set default 'maker',
  alter column plan_id set not null;

do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'paypal_subscriptions_plan_id_check'
      and conrelid = 'public.paypal_subscriptions'::regclass
  ) then
    alter table public.paypal_subscriptions
      add constraint paypal_subscriptions_plan_id_check check (plan_id in ('maker', 'pro'));
  end if;
end;
$$;

create or replace function public.create_paypal_checkout_intent(p_user_id text, p_plan_id text)
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

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id, 1));

  update public.paypal_checkout_intents
    set consumed_at = v_now
    where user_id = p_user_id
      and consumed_at is null
      and expires_at <= v_now;

  if exists (
    select 1 from public.paypal_subscriptions as subscriptions
    where subscriptions.user_id = p_user_id
      and subscriptions.successful_payment_at is not null
      and subscriptions.paid_through > v_now
  ) then
    raise exception 'An active paid plan already exists';
  end if;

  if exists (
    select 1 from public.paypal_subscriptions as subscriptions
    where subscriptions.user_id = p_user_id
      and subscriptions.status in ('APPROVAL_PENDING', 'APPROVED', 'ACTIVE', 'SUSPENDED')
      and subscriptions.cancellation_requested_at is null
  ) then
    raise exception 'An open PayPal subscription already exists';
  end if;

  select intents.id, intents.plan_id into v_intent_id, v_intent_plan_id
    from public.paypal_checkout_intents as intents
    where intents.user_id = p_user_id
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

  insert into public.paypal_checkout_intents (user_id, plan_id, expires_at)
    values (p_user_id, p_plan_id, v_now + interval '1 hour')
    returning id into v_intent_id;
  return v_intent_id;
end;
$$;

-- Preserve the old internal RPC for any in-flight server version.
create or replace function public.create_paypal_checkout_intent(p_user_id text)
returns uuid
language sql
security definer
set search_path = ''
as $$
  select public.create_paypal_checkout_intent(p_user_id, 'maker');
$$;

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
    where intents.id = p_checkout_intent_id;
  if v_user_id is null or v_plan_id is null or v_plan_id not in ('maker', 'pro') then
    raise exception 'PayPal checkout intent was not found';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_user_id, 1));

  select exists (
    select 1 from public.paypal_subscriptions as subscriptions
    where subscriptions.paypal_subscription_id = p_paypal_subscription_id
  ) into v_subscription_exists;

  if exists (
    select 1 from public.paypal_subscriptions as subscriptions
    where subscriptions.checkout_intent_id = p_checkout_intent_id
      and subscriptions.paypal_subscription_id <> p_paypal_subscription_id
  ) then
    raise exception 'PayPal checkout intent is already linked to another subscription';
  end if;

  if not v_subscription_exists and exists (
    select 1 from public.paypal_subscriptions as subscriptions
    where subscriptions.user_id = v_user_id
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
    where subscriptions.user_id = v_user_id
      and subscriptions.paypal_subscription_id <> p_paypal_subscription_id
      and subscriptions.successful_payment_at is not null
      and subscriptions.paid_through > v_now
  ) then
    raise exception 'Another paid entitlement is still active';
  end if;

  insert into public.paypal_webhook_events (event_id, event_type, paypal_subscription_id)
    values (p_event_id, p_event_type, p_paypal_subscription_id)
    on conflict (event_id) do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then
    return false;
  end if;

  insert into public.paypal_subscriptions (
    paypal_subscription_id, checkout_intent_id, user_id, plan_id, status,
    successful_payment_at, paid_through, updated_at
  ) values (
    p_paypal_subscription_id, p_checkout_intent_id, v_user_id, v_plan_id,
    coalesce(p_subscription_status, 'APPROVAL_PENDING'),
    case when p_payment_succeeded then v_now else null end,
    case when p_payment_succeeded then p_paid_through else null end,
    v_now
  )
  on conflict (paypal_subscription_id) do update set
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
    where id = p_checkout_intent_id;

  return true;
end;
$$;

create or replace function public.get_paypal_plan_entitlement(p_user_id text)
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

  select subscriptions.* into v_subscription
    from public.paypal_subscriptions as subscriptions
    where subscriptions.user_id = p_user_id
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

-- Compatibility for an older server: paid Pro is safely seen as paid Maker,
-- never as Free. New code reads the precise plan via get_paypal_plan_entitlement.
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
  select entitlement.plan_id in ('maker', 'pro'), entitlement.paypal_subscription_id,
    entitlement.subscription_status, entitlement.paid_through
  from public.get_paypal_plan_entitlement(p_user_id) as entitlement;
$$;

revoke all on function public.create_paypal_checkout_intent(text) from public, anon, authenticated;
revoke all on function public.create_paypal_checkout_intent(text, text) from public, anon, authenticated;
revoke all on function public.apply_paypal_webhook_event(text, text, text, uuid, text, timestamptz, boolean, boolean) from public, anon, authenticated;
revoke all on function public.get_paypal_plan_entitlement(text) from public, anon, authenticated;
revoke all on function public.get_paypal_maker_entitlement(text) from public, anon, authenticated;
grant execute on function public.create_paypal_checkout_intent(text) to service_role;
grant execute on function public.create_paypal_checkout_intent(text, text) to service_role;
grant execute on function public.apply_paypal_webhook_event(text, text, text, uuid, text, timestamptz, boolean, boolean) to service_role;
grant execute on function public.get_paypal_plan_entitlement(text) to service_role;
grant execute on function public.get_paypal_maker_entitlement(text) to service_role;

notify pgrst, 'reload schema';
