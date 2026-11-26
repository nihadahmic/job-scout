-- Insights: one row per application, and backdated status changes.

-- applications: every job that was ever marked applied, with its first applied date
-- (in Sarajevo time, for day and week counts) and how far it got.
-- security_invoker: the view runs as the caller, so the RLS on jobs and status_history
-- still limits it to the owner.
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
    a.last_change_at
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

-- change_status() with an optional date, so "applied yesterday" can be logged today.
-- Replaces the 3-argument version from 0001.
drop function if exists public.change_status(text, text, text);

create or replace function public.change_status(
    p_job_id text,
    p_status text,
    p_note text default null,
    p_changed_at timestamptz default null
)
returns public.jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
    old_status text;
    at timestamptz := coalesce(p_changed_at, now());
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
           applied_at = case when p_status = 'applied' and applied_at is null then at else applied_at end
     where id = p_job_id
    returning * into result;
    insert into public.status_history (job_id, from_status, to_status, note, changed_at)
    values (p_job_id, old_status, p_status, nullif(trim(p_note), ''), at);
    return result;
end;
$$;
revoke all on function public.change_status(text, text, text, timestamptz) from public, anon;
grant execute on function public.change_status(text, text, text, timestamptz) to authenticated;
