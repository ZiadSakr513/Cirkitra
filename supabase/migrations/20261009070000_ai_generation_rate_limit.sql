create table if not exists public.ai_generation_request_windows (
  user_id text not null,
  minute_bucket timestamptz not null,
  request_count smallint not null check (request_count between 1 and 5),
  primary key (user_id, minute_bucket)
);

create index if not exists ai_generation_request_windows_minute_bucket_idx
  on public.ai_generation_request_windows (minute_bucket);

alter table public.ai_generation_request_windows enable row level security;
revoke all on table public.ai_generation_request_windows from public, anon, authenticated;
grant all on table public.ai_generation_request_windows to service_role;

create or replace function public.reserve_ai_generation_rate_limit(p_user_id text)
returns table (allowed boolean, remaining integer, resets_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_bucket timestamptz := pg_catalog.date_trunc('minute', v_now);
  v_count integer;
begin
  if p_user_id is null or pg_catalog.btrim(p_user_id) = '' then
    raise exception 'User ID is required';
  end if;

  delete from public.ai_generation_request_windows
    where minute_bucket < v_bucket - interval '1 day';

  insert into public.ai_generation_request_windows (user_id, minute_bucket, request_count)
    values (p_user_id, v_bucket, 1)
    on conflict (user_id, minute_bucket) do update
      set request_count = public.ai_generation_request_windows.request_count + 1
      where public.ai_generation_request_windows.request_count < 5
    returning request_count into v_count;

  if v_count is null then
    select request_count into v_count
      from public.ai_generation_request_windows
      where user_id = p_user_id and minute_bucket = v_bucket;
    return query select false, 0, v_bucket + interval '1 minute';
    return;
  end if;

  return query select true, greatest(0, 5 - v_count), v_bucket + interval '1 minute';
end;
$$;

revoke all on function public.reserve_ai_generation_rate_limit(text) from public, anon, authenticated;
grant execute on function public.reserve_ai_generation_rate_limit(text) to service_role;

notify pgrst, 'reload schema';
