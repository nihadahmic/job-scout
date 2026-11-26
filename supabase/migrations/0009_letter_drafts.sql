-- Cover letter history: every Gemini draft and every saved edit, per job.
create table if not exists public.letter_drafts (
    id          bigint generated always as identity primary key,
    job_id      text not null references public.jobs (id) on delete cascade,
    created_at  timestamptz not null default now(),
    kind        text not null check (kind in ('draft', 'revision', 'edit', 'restore')),
    body        text not null,
    notes       text,          -- what the owner asked Gemini to change (revisions)
    model       text,          -- Gemini model that wrote it (drafts and revisions)
    problems    jsonb not null default '[]'::jsonb  -- rule checks that still failed
);
create index if not exists letter_drafts_job on public.letter_drafts (job_id, created_at desc);

alter table public.letter_drafts enable row level security;
create policy "owner reads drafts" on public.letter_drafts
    for select to authenticated using (public.is_owner());
create policy "owner adds drafts" on public.letter_drafts
    for insert to authenticated with check (public.is_owner());

revoke all on public.letter_drafts from anon;
grant select, insert on public.letter_drafts to authenticated;
grant select, insert, update, delete on public.letter_drafts to service_role;
