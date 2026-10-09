create table if not exists public.admin_ai_usage_resets (
  id uuid primary key default gen_random_uuid(),
  user_id text not null check (length(btrim(user_id)) > 0),
  reset_by text not null check (length(btrim(reset_by)) > 0),
  reset_at timestamptz not null,
  idempotency_key uuid not null unique,
  internal_note text,
  constraint admin_ai_usage_resets_note_length_check check (internal_note is null or length(internal_note) <= 1000)
);

create index if not exists admin_ai_usage_resets_user_time_idx
  on public.admin_ai_usage_resets (user_id, reset_at desc);

alter table public.admin_ai_usage_resets enable row level security;
revoke all on public.admin_ai_usage_resets from public, anon, authenticated;
grant all on public.admin_ai_usage_resets to service_role;

create or replace function public.reset_ai_generation_usage(
  p_user_id text,
  p_reset_by text,
  p_idempotency_key uuid,
  p_internal_note text default null
)
returns setof public.admin_ai_usage_resets
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing public.admin_ai_usage_resets%rowtype;
  v_now timestamptz;
begin
  if p_user_id is null or pg_catalog.btrim(p_user_id) = '' then
    raise exception 'Account ID is required';
  end if;
  if p_reset_by is null or pg_catalog.btrim(p_reset_by) = '' then
    raise exception 'Resetting administrator ID is required';
  end if;
  if p_idempotency_key is null then
    raise exception 'Reset operation ID is required';
  end if;
  if p_internal_note is not null and pg_catalog.length(p_internal_note) > 1000 then
    raise exception 'Reset note is too long';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('ai-usage-reset:' || p_idempotency_key::text, 0)
  );

  select resets.* into v_existing
    from public.admin_ai_usage_resets as resets
    where resets.idempotency_key = p_idempotency_key;

  if found then
    if v_existing.user_id is distinct from p_user_id
      or v_existing.reset_by is distinct from p_reset_by
      or v_existing.internal_note is distinct from nullif(pg_catalog.btrim(p_internal_note), '') then
      raise exception 'Reset operation ID was already used for a different request';
    end if;
    return query select v_existing.*;
    return;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id, 0));
  v_now := pg_catalog.clock_timestamp();

  return query
    insert into public.admin_ai_usage_resets (
      user_id, reset_by, reset_at, idempotency_key, internal_note
    ) values (
      p_user_id, p_reset_by, v_now, p_idempotency_key, nullif(pg_catalog.btrim(p_internal_note), '')
    )
    returning *;
end;
$$;

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
  v_now timestamptz;
  v_window_start timestamptz;
  v_latest_reset timestamptz;
  v_next_reset timestamptz;
  v_new_reset timestamptz;
  v_used integer;
  v_request_id uuid;
begin
  if p_user_id is null or pg_catalog.btrim(p_user_id) = '' then
    raise exception 'User ID is required';
  end if;
  if p_monthly_limit is null or p_monthly_limit < 0 or p_monthly_limit > 1000 then
    raise exception 'Monthly AI request limit is invalid';
  end if;
  if p_model is null or pg_catalog.btrim(p_model) = '' then
    raise exception 'Model is required';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id, 0));
  v_now := pg_catalog.clock_timestamp();
  v_window_start := v_now - interval '1 month';

  update public.ai_generation_requests
    set status = 'expired', finalized_at = v_now
    where user_id = p_user_id
      and status = 'reserved'
      and created_at < v_now - interval '10 minutes';

  select pg_catalog.max(resets.reset_at) into v_latest_reset
    from public.admin_ai_usage_resets as resets
    where resets.user_id = p_user_id;
  if v_latest_reset is not null then
    v_window_start := greatest(v_window_start, v_latest_reset);
  end if;

  select
      pg_catalog.count(*)::integer,
      pg_catalog.min(requests.created_at + interval '1 month')
    into v_used, v_next_reset
    from public.ai_generation_requests as requests
    where requests.user_id = p_user_id
      and requests.created_at > v_window_start
      and (
        requests.status = 'succeeded'
        or (requests.status = 'reserved' and requests.created_at >= v_now - interval '10 minutes')
      );

  if p_monthly_limit > 0 and v_used >= p_monthly_limit then
    return query select null::uuid, false, v_used, p_monthly_limit, v_next_reset;
    return;
  end if;

  insert into public.ai_generation_requests (user_id, model, created_at)
    values (p_user_id, p_model, v_now)
    returning request_id, created_at + interval '1 month'
    into v_request_id, v_new_reset;
  v_next_reset := least(coalesce(v_next_reset, v_new_reset), v_new_reset);

  return query select v_request_id, true, v_used + 1, p_monthly_limit, v_next_reset;
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
  v_now timestamptz;
  v_window_start timestamptz;
  v_latest_reset timestamptz;
begin
  if p_user_id is null or pg_catalog.btrim(p_user_id) = '' then
    raise exception 'User ID is required';
  end if;
  if p_monthly_limit is null or p_monthly_limit < 0 or p_monthly_limit > 1000 then
    raise exception 'Monthly AI request limit is invalid';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id, 0));
  v_now := pg_catalog.clock_timestamp();
  v_window_start := v_now - interval '1 month';

  select pg_catalog.max(resets.reset_at) into v_latest_reset
    from public.admin_ai_usage_resets as resets
    where resets.user_id = p_user_id;
  if v_latest_reset is not null then
    v_window_start := greatest(v_window_start, v_latest_reset);
  end if;

  return query
    select
      pg_catalog.count(*)::integer,
      p_monthly_limit,
      pg_catalog.min(requests.created_at + interval '1 month')
    from public.ai_generation_requests as requests
    where requests.user_id = p_user_id
      and requests.created_at > v_window_start
      and (
        requests.status = 'succeeded'
        or (requests.status = 'reserved' and requests.created_at >= v_now - interval '10 minutes')
      );
end;
$$;

revoke all on function public.reset_ai_generation_usage(text, text, uuid, text) from public, anon, authenticated;
revoke all on function public.reserve_ai_generation_request(text, integer, text) from public, anon, authenticated;
revoke all on function public.get_ai_generation_usage(text, integer) from public, anon, authenticated;
grant execute on function public.reset_ai_generation_usage(text, text, uuid, text) to service_role;
grant execute on function public.reserve_ai_generation_request(text, integer, text) to service_role;
grant execute on function public.get_ai_generation_usage(text, integer) to service_role;

notify pgrst, 'reload schema';
