-- Dated notes per job, like comments. Replaces the single undated jobs.notes field
-- (kept, no longer shown). Existing notes become each job's first, "earlier" note.
create table if not exists public.job_notes (
    id          bigint generated always as identity primary key,
    job_id      text not null references public.jobs (id) on delete cascade,
    created_at  timestamptz not null default now(),
    edited_at   timestamptz,
    body        text not null check (length(trim(body)) > 0),
    legacy      boolean not null default false  -- carried over from jobs.notes; real date unknown
);
create index if not exists job_notes_job on public.job_notes (job_id, created_at desc);

alter table public.job_notes enable row level security;
create policy "owner reads notes" on public.job_notes
    for select to authenticated using (public.is_owner());
create policy "owner adds notes" on public.job_notes
    for insert to authenticated with check (public.is_owner());
create policy "owner edits notes" on public.job_notes
    for update to authenticated using (public.is_owner()) with check (public.is_owner());
create policy "owner deletes notes" on public.job_notes
    for delete to authenticated using (public.is_owner());

revoke all on public.job_notes from anon;
grant select, insert, update, delete on public.job_notes to authenticated, service_role;

-- Carry over existing notes once. Notion imports are dated on the applied date; others on
-- the last status change, else when the job was found.
insert into public.job_notes (job_id, created_at, body, legacy)
select j.id,
       coalesce(case when j.source = 'notion' then j.applied_at end, j.status_changed_at, j.applied_at, j.first_seen_at),
       trim(j.notes),
       true
from public.jobs j
where j.notes is not null
  and length(trim(j.notes)) > 0
  and not exists (select 1 from public.job_notes n where n.job_id = j.id and n.legacy);
