-- PayPal subscriptions are written only by the server using service_role.
-- Browser approval never creates or modifies a Maker entitlement.

create table if not exists public.paypal_checkout_intents (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz
);

create index if not exists paypal_checkout_intents_user_created_idx
  on public.paypal_checkout_intents (user_id, created_at desc);

create table if not exists public.paypal_subscriptions (
  paypal_subscription_id text primary key,
  checkout_intent_id uuid not null references public.paypal_checkout_intents (id),
  user_id text not null,
  status text not null,
  successful_payment_at timestamptz,
  paid_through timestamptz,
  cancellation_requested_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint paypal_subscriptions_status_check check (
    status in ('APPROVAL_PENDING', 'APPROVED', 'ACTIVE', 'SUSPENDED', 'CANCELLED', 'EXPIRED')
  )
);

create index if not exists paypal_subscriptions_user_entitlement_idx
  on public.paypal_subscriptions (user_id, paid_through desc);

create table if not exists public.paypal_webhook_events (
  event_id text primary key,
  event_type text not null,
  paypal_subscription_id text not null,
  processed_at timestamptz not null default now()
);

alter table public.paypal_checkout_intents enable row level security;
alter table public.paypal_subscriptions enable row level security;
alter table public.paypal_webhook_events enable row level security;

revoke all on public.paypal_checkout_intents from public, anon, authenticated;
revoke all on public.paypal_subscriptions from public, anon, authenticated;
revoke all on public.paypal_webhook_events from public, anon, authenticated;
grant all on public.paypal_checkout_intents to service_role;
grant all on public.paypal_subscriptions to service_role;
grant all on public.paypal_webhook_events to service_role;

create or replace function public.create_paypal_checkout_intent(p_user_id text)
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

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id, 1));

  if exists (
    select 1 from public.paypal_subscriptions as subscriptions
    where subscriptions.user_id = p_user_id
      and subscriptions.status in ('APPROVAL_PENDING', 'APPROVED', 'ACTIVE', 'SUSPENDED')
      and subscriptions.cancellation_requested_at is null
  ) then
    raise exception 'An open Maker subscription already exists';
  end if;

  select intents.id into v_intent_id
    from public.paypal_checkout_intents as intents
    where intents.user_id = p_user_id
      and intents.consumed_at is null
      and intents.expires_at > v_now
    order by intents.created_at desc
    limit 1;

  if v_intent_id is not null then
    return v_intent_id;
  end if;

  insert into public.paypal_checkout_intents (user_id, expires_at)
    values (p_user_id, v_now + interval '1 hour')
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
  v_inserted integer;
  v_now timestamptz := pg_catalog.clock_timestamp();
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

  select intents.user_id into v_user_id
    from public.paypal_checkout_intents as intents
    where intents.id = p_checkout_intent_id;
  if v_user_id is null then
    raise exception 'PayPal checkout intent was not found';
  end if;

  insert into public.paypal_webhook_events (event_id, event_type, paypal_subscription_id)
    values (p_event_id, p_event_type, p_paypal_subscription_id)
    on conflict (event_id) do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then
    return false;
  end if;

  insert into public.paypal_subscriptions (
    paypal_subscription_id, checkout_intent_id, user_id, status,
    successful_payment_at, paid_through, updated_at
  ) values (
    p_paypal_subscription_id, p_checkout_intent_id, v_user_id,
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
    and paypal_subscriptions.user_id = v_user_id;

  if not found then
    raise exception 'PayPal subscription identity does not match its checkout intent';
  end if;

  update public.paypal_checkout_intents
    set consumed_at = coalesce(consumed_at, v_now)
    where id = p_checkout_intent_id;

  return true;
end;
$$;

create or replace function public.get_paypal_maker_entitlement(p_user_id text)
returns table (
  has_maker boolean,
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
    order by subscriptions.paid_through desc
    limit 1;

  if v_subscription.paypal_subscription_id is null then
    return query select false, null::text, null::text, null::timestamptz;
  else
    return query select true, v_subscription.paypal_subscription_id, v_subscription.status, v_subscription.paid_through;
  end if;
end;
$$;

revoke all on function public.create_paypal_checkout_intent(text) from public, anon, authenticated;
revoke all on function public.apply_paypal_webhook_event(text, text, text, uuid, text, timestamptz, boolean, boolean) from public, anon, authenticated;
revoke all on function public.get_paypal_maker_entitlement(text) from public, anon, authenticated;
grant execute on function public.create_paypal_checkout_intent(text) to service_role;
grant execute on function public.apply_paypal_webhook_event(text, text, text, uuid, text, timestamptz, boolean, boolean) to service_role;
grant execute on function public.get_paypal_maker_entitlement(text) to service_role;

notify pgrst, 'reload schema';
