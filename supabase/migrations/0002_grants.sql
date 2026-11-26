-- Explicit table privileges for the API roles.
-- Newer Supabase projects don't grant tables created in the SQL editor to the Data API
-- roles automatically, so without this even the secret key gets "permission denied".
-- Row-level security (0001) still decides which rows a signed-in user sees.

grant usage on schema public to anon, authenticated, service_role;

-- Collector (secret key -> service_role): full access to the data tables.
grant select, insert, update, delete on public.jobs, public.runs, public.status_history to service_role;
grant usage, select on all sequences in schema public to service_role;

-- Review app (signed-in user -> authenticated): read, filtered by RLS to the owner.
grant select on public.jobs, public.status_history, public.runs to authenticated;
grant update (notes) on public.jobs to authenticated;

-- Signed-out visitors (publishable key -> anon): nothing.
revoke all on public.jobs, public.runs, public.status_history, public.app_owner from anon;
