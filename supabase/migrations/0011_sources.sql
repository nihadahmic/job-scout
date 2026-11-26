-- Sources managed in the app: the company watchlist (was companies.yaml in the data repo),
-- RSS/Atom feeds, requests for new source types, and on/off switches for built-in boards.
-- The collector reads these with the secret key and writes back per-source stats.

create table if not exists public.watchlist (
    id              bigint generated always as identity primary key,
    name            text not null,
    website         text not null unique,
    ats             text not null default 'unknown',
    slug            text,
    ats_region      text,
    board_name      text,               -- shown as the company when the board belongs to a parent or new brand
    ats_note        text,
    ats_locked      boolean not null default false,
    paused          boolean not null default false,
    added_at        timestamptz not null default now(),
    detected_at     timestamptz,
    -- written by the collector after each run
    last_checked_at timestamptz,
    last_fetched    integer,
    last_kept       integer,
    last_new        integer,
    last_error      text,
    last_kept_at    timestamptz
);
create index if not exists watchlist_ats on public.watchlist (ats) where not paused;

create table if not exists public.feeds (
    id              bigint generated always as identity primary key,
    name            text not null,
    url             text not null unique,
    all_remote      boolean not null default true,  -- treat every item as remote (remote-only boards)
    paused          boolean not null default false,
    added_at        timestamptz not null default now(),
    last_checked_at timestamptz,
    last_fetched    integer,
    last_kept       integer,
    last_new        integer,
    last_error      text
);

create table if not exists public.source_requests (
    id          bigint generated always as identity primary key,
    name        text not null,
    url         text,
    note        text,
    status      text not null default 'open' check (status in ('open', 'done', 'declined')),
    resolution  text,
    created_at  timestamptz not null default now(),
    resolved_at timestamptz
);

create table if not exists public.source_settings (
    source      text primary key,           -- himalayas, remotive, weworkremotely, greenhouse, ...
    enabled     boolean not null default true,
    updated_at  timestamptz not null default now()
);

-- watchlist: owner only (row-level security), plus the collector's secret key.
alter table public.watchlist enable row level security;
create policy "owner reads watchlist" on public.watchlist
    for select to authenticated using (public.is_owner());
create policy "owner adds watchlist" on public.watchlist
    for insert to authenticated with check (public.is_owner());
create policy "owner edits watchlist" on public.watchlist
    for update to authenticated using (public.is_owner()) with check (public.is_owner());
create policy "owner deletes watchlist" on public.watchlist
    for delete to authenticated using (public.is_owner());
revoke all on public.watchlist from anon;
grant select, insert, update, delete on public.watchlist to authenticated, service_role;

-- feeds: owner only (row-level security), plus the collector's secret key.
alter table public.feeds enable row level security;
create policy "owner reads feeds" on public.feeds
    for select to authenticated using (public.is_owner());
create policy "owner adds feeds" on public.feeds
    for insert to authenticated with check (public.is_owner());
create policy "owner edits feeds" on public.feeds
    for update to authenticated using (public.is_owner()) with check (public.is_owner());
create policy "owner deletes feeds" on public.feeds
    for delete to authenticated using (public.is_owner());
revoke all on public.feeds from anon;
grant select, insert, update, delete on public.feeds to authenticated, service_role;

-- source_requests: owner only (row-level security), plus the collector's secret key.
alter table public.source_requests enable row level security;
create policy "owner reads source_requests" on public.source_requests
    for select to authenticated using (public.is_owner());
create policy "owner adds source_requests" on public.source_requests
    for insert to authenticated with check (public.is_owner());
create policy "owner edits source_requests" on public.source_requests
    for update to authenticated using (public.is_owner()) with check (public.is_owner());
create policy "owner deletes source_requests" on public.source_requests
    for delete to authenticated using (public.is_owner());
revoke all on public.source_requests from anon;
grant select, insert, update, delete on public.source_requests to authenticated, service_role;

-- source_settings: owner only (row-level security), plus the collector's secret key.
alter table public.source_settings enable row level security;
create policy "owner reads source_settings" on public.source_settings
    for select to authenticated using (public.is_owner());
create policy "owner adds source_settings" on public.source_settings
    for insert to authenticated with check (public.is_owner());
create policy "owner edits source_settings" on public.source_settings
    for update to authenticated using (public.is_owner()) with check (public.is_owner());
create policy "owner deletes source_settings" on public.source_settings
    for delete to authenticated using (public.is_owner());
revoke all on public.source_settings from anon;
grant select, insert, update, delete on public.source_settings to authenticated, service_role;

grant usage, select on all sequences in schema public to authenticated, service_role;
