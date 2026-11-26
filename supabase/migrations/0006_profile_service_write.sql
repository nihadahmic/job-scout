-- Let scripts using the secret key fill in the profile (for example a one-off pre-fill
-- from local files). The secret key already has full access to the job tables.
grant insert, update on public.profile to service_role;
