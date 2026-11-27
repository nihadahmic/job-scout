-- Notion sync: your Notion "Applications" database, imported each run (notion_sync/).
-- One row per Notion page, so a page is never imported twice and a later stage in Notion
-- (Applied, Interview, Won't be moving forward...) moves its job forward in the app.

create table if not exists public.notion_pages (
    page_id        text primary key,                 -- Notion page id, no dashes
    job_id         text references public.jobs (id) on delete set null,
    stages         text[] not null default '{}',     -- Notion stages, as last seen
    page_edited_at timestamptz,                      -- Notion's last_edited_time, as last seen
    imported_at    timestamptz not null default now(),
    synced_at      timestamptz,
    last_error     text
);
create index if not exists notion_pages_job on public.notion_pages (job_id);

alter table public.notion_pages enable row level security;
create policy "owner reads notion pages" on public.notion_pages
    for select to authenticated using (public.is_owner());
revoke all on public.notion_pages from anon;
revoke insert, update, delete on public.notion_pages from authenticated;
grant select on public.notion_pages to authenticated;
grant select, insert, update, delete on public.notion_pages to service_role;
