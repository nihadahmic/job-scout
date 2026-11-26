-- Screening: when a job was screened, by which model, and any error (retried next run).
-- tier, fit, fit_reason, eligibility_note and dropped_reason already exist on jobs.
alter table public.jobs add column if not exists screened_at timestamptz;
alter table public.jobs add column if not exists screening_model text;
alter table public.jobs add column if not exists screening_error text;
create index if not exists jobs_tier_fit on public.jobs (tier, fit desc);
