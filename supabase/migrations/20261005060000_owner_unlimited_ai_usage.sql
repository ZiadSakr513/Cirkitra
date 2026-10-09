-- A zero monthly limit is a server-controlled sentinel for unlimited owner access.
-- The RPCs remain service-role-only; the app decides whether a verified Firebase
-- UID matches CIRKITRA_OWNER_UID before passing zero.

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
  v_window_start timestamptz;
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

  v_window_start := v_now - interval '1 month';

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id, 0));
  update public.ai_generation_requests
    set status = 'expired', finalized_at = v_now
    where user_id = p_user_id
      and status = 'reserved'
      and created_at < v_now - interval '10 minutes';

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

  insert into public.ai_generation_requests (user_id, model)
    values (p_user_id, p_model)
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
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_window_start timestamptz;
begin
  if p_user_id is null or pg_catalog.btrim(p_user_id) = '' then
    raise exception 'User ID is required';
  end if;
  if p_monthly_limit is null or p_monthly_limit < 0 or p_monthly_limit > 1000 then
    raise exception 'Monthly AI request limit is invalid';
  end if;

  v_window_start := v_now - interval '1 month';
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

revoke all on function public.reserve_ai_generation_request(text, integer, text) from public, anon, authenticated;
revoke all on function public.get_ai_generation_usage(text, integer) from public, anon, authenticated;
grant execute on function public.reserve_ai_generation_request(text, integer, text) to service_role;
grant execute on function public.get_ai_generation_usage(text, integer) to service_role;

notify pgrst, 'reload schema';
