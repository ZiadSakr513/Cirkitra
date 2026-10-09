-- Allow an immediate Maker-to-Pro purchase only when the existing Maker
-- subscription has already been cancelled and has a paid-through period left.
-- Abandoned checkouts remain retryable; an actively-renewing Maker plan still
-- blocks a second recurring subscription.
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
      and not (
        p_plan_id = 'pro'
        and subscriptions.plan_id = 'maker'
        and (subscriptions.cancellation_requested_at is not null or subscriptions.status = 'CANCELLED')
      )
  ) then
    raise exception 'An active paid plan already exists';
  end if;

  -- A fresh intent per click lets a buyer retry if they leave PayPal before
  -- approving. The existing unpaid attempt stays in history.
  update public.paypal_checkout_intents
    set consumed_at = v_now
    where user_id = p_user_id
      and environment = p_environment
      and consumed_at is null
      and expires_at > v_now;

  insert into public.paypal_checkout_intents (user_id, plan_id, environment, expires_at)
    values (p_user_id, p_plan_id, p_environment, v_now + interval '1 hour')
    returning id into v_intent_id;
  return v_intent_id;
end;
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
      and subscriptions.successful_payment_at is not null
      and subscriptions.paid_through > v_now
      and not (
        v_plan_id = 'pro'
        and subscriptions.plan_id = 'maker'
        and (subscriptions.cancellation_requested_at is not null or subscriptions.status = 'CANCELLED')
      )
  ) then
    raise exception 'Another paid plan is already active';
  end if;

  if p_payment_succeeded and exists (
    select 1 from public.paypal_subscriptions as subscriptions
    where subscriptions.environment = p_environment
      and subscriptions.user_id = v_user_id
      and subscriptions.paypal_subscription_id <> p_paypal_subscription_id
      and subscriptions.successful_payment_at is not null
      and subscriptions.paid_through > v_now
      and not (
        v_plan_id = 'pro'
        and subscriptions.plan_id = 'maker'
        and (subscriptions.cancellation_requested_at is not null or subscriptions.status = 'CANCELLED')
      )
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
    successful_payment_at, paid_through, cancellation_requested_at, updated_at
  ) values (
    p_paypal_subscription_id, p_checkout_intent_id, v_user_id, v_plan_id, p_environment,
    coalesce(p_subscription_status, 'APPROVAL_PENDING'),
    case when p_payment_succeeded then v_now else null end,
    case when p_payment_succeeded then p_paid_through else null end,
    case when p_subscription_status = 'CANCELLED' then v_now else null end,
    v_now
  )
  on conflict (environment, paypal_subscription_id) do update set
    status = coalesce(p_subscription_status, paypal_subscriptions.status),
    cancellation_requested_at = case
      when p_subscription_status = 'CANCELLED' then coalesce(paypal_subscriptions.cancellation_requested_at, v_now)
      else paypal_subscriptions.cancellation_requested_at
    end,
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

revoke all on function public.create_paypal_checkout_intent(text, text, text) from public, anon, authenticated;
grant execute on function public.create_paypal_checkout_intent(text, text, text) to service_role;
revoke all on function public.apply_paypal_webhook_event(text, text, text, uuid, text, timestamptz, text, boolean, boolean) from public, anon, authenticated;
grant execute on function public.apply_paypal_webhook_event(text, text, text, uuid, text, timestamptz, text, boolean, boolean) to service_role;

notify pgrst, 'reload schema';
