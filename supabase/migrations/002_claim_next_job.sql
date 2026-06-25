-- Atomic job claim for the cron orchestrator.
--
-- Picks a runnable job (status='pending', or status='running' with an
-- expired/null next_run_at), excluding jobs whose device already has another
-- 'running' row. Marks it 'running', sets a lock window via next_run_at,
-- bumps attempts, returns the full row.
--
-- Uses FOR UPDATE SKIP LOCKED so concurrent cron invocations never collide.
-- Returns NULL if nothing is claimable.

-- Drop the previous single-row return variant if upgrading from an earlier
-- version of this file — the return type can't be changed in place.
drop function if exists public.claim_next_job(integer);

create or replace function public.claim_next_job(p_lock_seconds int default 90)
returns setof public.jobs
language plpgsql
as $$
declare
  claimed public.jobs;
begin
  select j.* into claimed
  from public.jobs j
  where
    (
      j.status = 'pending'
      or (j.status = 'running' and (j.next_run_at is null or j.next_run_at <= now()))
    )
    and (
      j.device_id is null
      or not exists (
        select 1 from public.jobs other
        where other.id <> j.id
          and other.device_id = j.device_id
          and other.status = 'running'
      )
    )
  order by random()
  limit 1
  for update skip locked;

  if not found then
    return;
  end if;

  update public.jobs
  set
    status = 'running',
    started_at = coalesce(started_at, now()),
    next_run_at = now() + (p_lock_seconds || ' seconds')::interval,
    attempts = attempts + 1,
    updated_at = now()
  where id = claimed.id
  returning * into claimed;

  return next claimed;
end;
$$;

-- The cron route uses the service_role key so RLS is already bypassed.
-- Plain SECURITY INVOKER (the default) is correct here.
