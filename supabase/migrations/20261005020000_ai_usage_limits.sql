create table if not exists public.ai_generation_requests (
  request_id uuid primary key default gen_random_uuid(),
  user_id text not null,
  status text not null default 'reserved'
    check (status in ('reserved', 'succeeded', 'failed', 'expired')),
  model text not null,
  input_tokens integer not null default 0 check (input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  created_at timestamptz not null default now(),
  finalized_at timestamptz
);

create index if not exists ai_generation_requests_user_created_idx
  on public.ai_generation_requests (user_id, created_at desc);

alter table public.ai_generation_requests enable row level security;
revoke all on table public.ai_generation_requests from public, anon, authenticated;
grant all on table public.ai_generation_requests to service_role;

create or replace function public.reserve_ai_generation_request(
  p_user_id text,
  p_monthly_limit integer,
  p_model text
)
returns table (
  reservation_id uuid,
  allowed boolean,
  used_count integer,
  monthly_limit integer,
  resets_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_month_start timestamptz;
  v_next_month timestamptz;
  v_used integer;
  v_request_id uuid;
begin
  if p_user_id is null or pg_catalog.btrim(p_user_id) = '' then
    raise exception 'User ID is required';
  end if;
  if p_monthly_limit is null or p_monthly_limit < 1 or p_monthly_limit > 1000 then
    raise exception 'Monthly AI request limit is invalid';
  end if;
  if p_model is null or pg_catalog.btrim(p_model) = '' then
    raise exception 'Model is required';
  end if;

  v_month_start := pg_catalog.date_trunc('month', v_now at time zone 'UTC') at time zone 'UTC';
  v_next_month := v_month_start + interval '1 month';

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id, 0));
  update public.ai_generation_requests
    set status = 'expired', finalized_at = v_now
    where user_id = p_user_id
      and status = 'reserved'
      and created_at < v_now - interval '10 minutes';

  select pg_catalog.count(*)::integer into v_used
    from public.ai_generation_requests as requests
    where requests.user_id = p_user_id
      and requests.created_at >= v_month_start
      and requests.created_at < v_next_month
      and requests.status in ('succeeded', 'reserved');

  if v_used >= p_monthly_limit then
    return query select null::uuid, false, v_used, p_monthly_limit, v_next_month;
    return;
  end if;

  insert into public.ai_generation_requests (user_id, model)
    values (p_user_id, p_model)
    returning request_id into v_request_id;
  return query select v_request_id, true, v_used + 1, p_monthly_limit, v_next_month;
end;
$$;

create or replace function public.finalize_ai_generation_request(
  p_request_id uuid,
  p_user_id text,
  p_succeeded boolean,
  p_input_tokens integer,
  p_output_tokens integer,
  p_model text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.ai_generation_requests
    set status = case when p_succeeded then 'succeeded' else 'failed' end,
        input_tokens = greatest(0, coalesce(p_input_tokens, 0)),
        output_tokens = greatest(0, coalesce(p_output_tokens, 0)),
        model = coalesce(nullif(pg_catalog.btrim(p_model), ''), model),
        finalized_at = pg_catalog.clock_timestamp()
    where request_id = p_request_id
      and user_id = p_user_id
      and status = 'reserved';
  return found;
end;
$$;

create or replace function public.get_ai_generation_usage(
  p_user_id text,
  p_monthly_limit integer
)
returns table (
  used_count integer,
  monthly_limit integer,
  resets_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_month_start timestamptz;
  v_next_month timestamptz;
begin
  if p_user_id is null or pg_catalog.btrim(p_user_id) = '' then
    raise exception 'User ID is required';
  end if;
  if p_monthly_limit is null or p_monthly_limit < 1 or p_monthly_limit > 1000 then
    raise exception 'Monthly AI request limit is invalid';
  end if;

  v_month_start := pg_catalog.date_trunc('month', v_now at time zone 'UTC') at time zone 'UTC';
  v_next_month := v_month_start + interval '1 month';
  return query
    select pg_catalog.count(*)::integer, p_monthly_limit, v_next_month
    from public.ai_generation_requests as requests
    where requests.user_id = p_user_id
      and requests.created_at >= v_month_start
      and requests.created_at < v_next_month
      and (
        requests.status = 'succeeded'
        or (requests.status = 'reserved' and requests.created_at >= v_now - interval '10 minutes')
      );
end;
$$;

revoke all on function public.reserve_ai_generation_request(text, integer, text) from public, anon, authenticated;
revoke all on function public.finalize_ai_generation_request(uuid, text, boolean, integer, integer, text) from public, anon, authenticated;
revoke all on function public.get_ai_generation_usage(text, integer) from public, anon, authenticated;
grant execute on function public.reserve_ai_generation_request(text, integer, text) to service_role;
grant execute on function public.finalize_ai_generation_request(uuid, text, boolean, integer, integer, text) to service_role;
grant execute on function public.get_ai_generation_usage(text, integer) to service_role;
