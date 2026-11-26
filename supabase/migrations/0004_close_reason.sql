-- Close reasons: why a job left the pipeline (rejected, withdrew, declined...).
-- Set only through change_status(); cleared when a job moves back to an active status.

alter table public.jobs add column if not exists close_reason text;
alter table public.status_history add column if not exists reason text;

-- The view gains close_reason (appended, so existing columns keep their order).
create or replace view public.applications
with (security_invoker = true) as
select
    j.id,
    j.company,
    j.title,
    j.source,
    j.category,
    j.location_match,
    j.status,
    j.url,
    a.applied_at,
    (a.applied_at at time zone 'Europe/Sarajevo')::date as applied_day,
    a.replied_at,
    a.interviewed,
    a.offered,
    a.last_change_at,
    j.close_reason
from public.jobs j
join (
    select
        job_id,
        min(changed_at) filter (where to_status = 'applied') as applied_at,
        min(changed_at) filter (
            where to_status in ('interviewing', 'offer', 'not_moving_forward', 'accepted', 'declined')
        ) as replied_at,
        bool_or(to_status in ('interviewing', 'offer', 'accepted', 'declined')) as interviewed,
        bool_or(to_status in ('offer', 'accepted', 'declined')) as offered,
        max(changed_at) as last_change_at
    from public.status_history
    group by job_id
) a on a.job_id = j.id
where a.applied_at is not null;

revoke all on public.applications from anon;
grant select on public.applications to authenticated, service_role;

-- change_status() with a close reason. Replaces the 4-argument version from 0003.
drop function if exists public.change_status(text, text, text, timestamptz);

create or replace function public.change_status(
    p_job_id text,
    p_status text,
    p_note text default null,
    p_changed_at timestamptz default null,
    p_reason text default null
)
returns public.jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
    old_status text;
    at timestamptz := coalesce(p_changed_at, now());
    closing boolean := p_status in ('skipped', 'withdrawn', 'not_moving_forward', 'accepted', 'declined');
    reason text := nullif(trim(p_reason), '');
    result public.jobs;
begin
    if not public.is_owner() then
        raise exception 'not allowed' using errcode = '42501';
    end if;
    if at > now() + interval '1 hour' then
        raise exception 'date is in the future' using errcode = '22007';
    end if;
    select status into old_status from public.jobs where id = p_job_id for update;
    if not found then
        raise exception 'job % not found', p_job_id using errcode = 'P0002';
    end if;
    update public.jobs
       set status = p_status,
           status_changed_at = at,
           applied_at = case when p_status = 'applied' and applied_at is null then at else applied_at end,
           close_reason = case when closing then coalesce(reason, close_reason) else null end
     where id = p_job_id
    returning * into result;
    insert into public.status_history (job_id, from_status, to_status, note, reason, changed_at)
    values (p_job_id, old_status, p_status, nullif(trim(p_note), ''), reason, at);
    return result;
end;
$$;
revoke all on function public.change_status(text, text, text, timestamptz, text) from public, anon;
grant execute on function public.change_status(text, text, text, timestamptz, text) to authenticated;
