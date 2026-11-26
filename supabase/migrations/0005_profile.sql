-- Profile: the owner's search preferences, facts for application forms, writing material,
-- and a private bucket for CV files. Readable by the owner in the app and by the collector
-- (secret key); nobody else.

create table if not exists public.profile (
    user_id        uuid primary key default auth.uid() references auth.users (id) on delete cascade,
    preferences    jsonb not null default '{}'::jsonb,  -- categories, seniority, work type, locations, salary, skip list
    weekly_goal    smallint check (weekly_goal between 0 and 100),
    facts          jsonb not null default '{}'::jsonb,  -- notice period, authorization, links: filled by the app, never sent to an AI model
    experience     text,                                -- anonymized: no name, contacts or employer names (this is what drafting sends to Gemini)
    writing_rules  text,
    current_cv     text,                                -- storage path of the CV marked current
    updated_at     timestamptz not null default now()
);

alter table public.profile enable row level security;
create policy "owner reads profile" on public.profile
    for select to authenticated using (public.is_owner() and user_id = auth.uid());
create policy "owner creates profile" on public.profile
    for insert to authenticated with check (public.is_owner() and user_id = auth.uid());
create policy "owner updates profile" on public.profile
    for update to authenticated using (public.is_owner() and user_id = auth.uid())
    with check (public.is_owner() and user_id = auth.uid());

revoke all on public.profile from anon;
grant select, insert, update on public.profile to authenticated;
grant select on public.profile to service_role;

create or replace function public.touch_profile()
returns trigger language plpgsql set search_path = '' as $$
begin
    new.updated_at := now();
    return new;
end;
$$;
drop trigger if exists profile_touch on public.profile;
create trigger profile_touch before update on public.profile
    for each row execute function public.touch_profile();

-- CV files: private bucket, PDF only, 10 MB max. Files live under "<user id>/...".
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('cv', 'cv', false, 10485760, array['application/pdf'])
on conflict (id) do update
    set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy "owner reads own CVs" on storage.objects
    for select to authenticated
    using (bucket_id = 'cv' and public.is_owner() and (storage.foldername(name))[1] = auth.uid()::text);
create policy "owner uploads own CVs" on storage.objects
    for insert to authenticated
    with check (bucket_id = 'cv' and public.is_owner() and (storage.foldername(name))[1] = auth.uid()::text);
create policy "owner deletes own CVs" on storage.objects
    for delete to authenticated
    using (bucket_id = 'cv' and public.is_owner() and (storage.foldername(name))[1] = auth.uid()::text);
