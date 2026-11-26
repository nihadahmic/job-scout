-- job-scout schema. Apply once in the Supabase SQL editor (or `supabase db push`).
-- Not re-runnable as is (create policy has no "if not exists"); changes go in new files.
-- Access model: the collector writes with the secret key (bypasses RLS). The review app
-- reads and writes as the signed-in user, and every table only answers to the owner
-- listed in app_owner. Nobody else, signed in or not, can read a row.

-- Owner ---------------------------------------------------------------------
create table if not exists public.app_owner (
    user_id uuid primary key references auth.users (id) on delete cascade
);
alter table public.app_owner enable row level security;
-- No policies on app_owner: it is managed by hand in the SQL editor, never via the API.

create or replace function public.is_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select exists (select 1 from public.app_owner where user_id = auth.uid());
$$;
revoke all on function public.is_owner() from public, anon;
grant execute on function public.is_owner() to authenticated;

-- Jobs ----------------------------------------------------------------------
create table if not exists public.jobs (
    id                   text primary key,             -- "<source>:<source_id>"
    source               text not null,
    source_id            text not null,
    url                  text not null,
    company              text not null,
    title                text not null,
    category             text,                         -- product_manager, product_owner, ...
    location_text        text,
    location_match       text,                         -- why it passed: balkans, europe, cet, worldwide, description
    remote               boolean not null,
    posted_at            timestamptz,
    description          text,
    salary_text          text,
    salary_min_eur_month numeric,                      -- approximate, for filtering only
    salary_max_eur_month numeric,
    apply_url            text,
    first_seen_at        timestamptz not null,
    dedupe_key           text not null,
    extra                jsonb not null default '{}'::jsonb,
    -- screening (later)
    tier                 smallint,
    fit                  smallint,
    fit_reason           text,
    eligibility_note     text,
    dropped_reason       text,
    -- review
    status               text not null default 'new',
    status_changed_at    timestamptz,
    notes                text,
    cover_letter         text,
    answers              jsonb,
    salary_answer        text,
    applied_at           timestamptz,
    search               tsvector generated always as (
        setweight(to_tsvector('simple', coalesce(title, '')), 'A') ||
        setweight(to_tsvector('simple', coalesce(company, '')), 'A') ||
        setweight(to_tsvector('english', coalesce(description, '')), 'C')
    ) stored,
    constraint jobs_status_check check (status in (
        'new', 'shortlisted', 'in_progress', 'applied', 'interviewing', 'offer',
        'skipped', 'withdrawn', 'not_moving_forward', 'accepted', 'declined'
    ))
);
create index if not exists jobs_dedupe_key on public.jobs (dedupe_key);
create index if not exists jobs_status on public.jobs (status);
create index if not exists jobs_posted_at on public.jobs (posted_at desc);
create index if not exists jobs_first_seen_at on public.jobs (first_seen_at desc);
create index if not exists jobs_category on public.jobs (category);
create index if not exists jobs_search on public.jobs using gin (search);

alter table public.jobs enable row level security;
create policy "owner reads jobs" on public.jobs
    for select to authenticated using (public.is_owner());
create policy "owner updates jobs" on public.jobs
    for update to authenticated using (public.is_owner()) with check (public.is_owner());
-- No insert or delete from the app: the collector inserts, nothing deletes.
-- The app may only edit notes directly. Status goes through change_status(), so every
-- change lands in status_history.
revoke insert, update, delete on public.jobs from anon, authenticated;
grant update (notes) on public.jobs to authenticated;

-- Status history ------------------------------------------------------------
create table if not exists public.status_history (
    id          bigint generated always as identity primary key,
    job_id      text not null references public.jobs (id) on delete cascade,
    from_status text,
    to_status   text not null,
    note        text,
    changed_at  timestamptz not null default now()
);
create index if not exists status_history_job on public.status_history (job_id, changed_at desc);
alter table public.status_history enable row level security;
create policy "owner reads history" on public.status_history
    for select to authenticated using (public.is_owner());
-- Rows are written only by change_status() below.
revoke insert, update, delete on public.status_history from anon, authenticated;

-- Collector runs ------------------------------------------------------------
create table if not exists public.runs (
    id          bigint generated always as identity primary key,
    started_at  timestamptz not null,
    finished_at timestamptz not null,
    summary     jsonb not null
);
alter table public.runs enable row level security;
create policy "owner reads runs" on public.runs
    for select to authenticated using (public.is_owner());
revoke insert, update, delete on public.runs from anon, authenticated;
revoke all on public.app_owner from anon, authenticated;

-- Status changes: update the job and write the history row together ----------
create or replace function public.change_status(p_job_id text, p_status text, p_note text default null)
returns public.jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
    old_status text;
    result public.jobs;
begin
    if not public.is_owner() then
        raise exception 'not allowed' using errcode = '42501';
    end if;
    select status into old_status from public.jobs where id = p_job_id for update;
    if not found then
        raise exception 'job % not found', p_job_id using errcode = 'P0002';
    end if;
    update public.jobs
       set status = p_status,
           status_changed_at = now(),
           applied_at = case when p_status = 'applied' and applied_at is null then now() else applied_at end
     where id = p_job_id
    returning * into result;
    insert into public.status_history (job_id, from_status, to_status, note)
    values (p_job_id, old_status, p_status, nullif(trim(p_note), ''));
    return result;
end;
$$;
revoke all on function public.change_status(text, text, text) from public, anon;
grant execute on function public.change_status(text, text, text) to authenticated;
