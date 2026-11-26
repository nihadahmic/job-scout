# job-scout

Personal job-search pipeline for Nihad Ahmic (Senior PM, Sarajevo, Bosnia and Herzegovina). It finds remote roles he can actually take, screens them with a cheap model, and hands a short daily shortlist to Claude for drafting. A human approves every application. Nothing is ever submitted automatically.

This is also a portfolio piece, so keep the code clean, the README clear, and the decisions written down.

## Goals
- Find relevant roles daily without using Claude tokens for collection and screening.
- Shortlist about 10 strong roles a day, with honest fit scores and reasons.
- Track outcomes (applications per week, replies by source and tier) for a case study.

## Non-goals
- No auto-applying, no mass applications.
- No LinkedIn scraping in this repo. LinkedIn stays a private, manual step outside this project (its terms forbid automation). Don't add LinkedIn code, cookies or session handling here.

## Architecture (build in this order, each step usable on its own)
1. **Collector** (Python 3.12, `collector/`): pulls listings from public sources, normalizes them to one schema, removes duplicates, saves new ones.
2. **Screening** (`screening/`): Gemini Flash scores each new listing and returns strict JSON. Free tier, so keep requests small and batched.
3. **Review app** (Next.js on Vercel, `app/`): the whole backlog with filters (job category, date posted, salary where given, location/region, source, company, text search; tier and fit once screening exists), a job detail page with notes, and status changes. Login is a Supabase Auth magic link for his account only: public sign-ups off, row-level security on every table. Built before screening.
4. **Drafting** (`drafting/`): deferred, no Claude API for now (decided 2026-11-26). When picked up: Claude API writes the cover letter, question answers and salary note for approved shortlist items only.
5. **Metrics**: weekly counts and reply rates by source and tier.

Scheduling: GitHub Actions cron, daily at 07:30 UTC.

## Storage
- Supabase (Postgres, free tier) is the single store since 2026-11-26. The collector writes over the REST API with the secret key (`SUPABASE_URL`, `SUPABASE_SERVICE_KEY`); the review app reads as the signed-in user with the publishable key. Schema and grants live in `supabase/migrations/` (new changes go in new numbered files, applied in the Supabase SQL editor).
- Access control is in the database: RLS on every table, `app_owner` names the one allowed account (set by hand, never in the repo), the app may only update `notes` and call `change_status()`. Never put the secret key in a `NEXT_PUBLIC_*` variable; `app/next.config.ts` refuses to build if it is.
- SQLite (`--db`) remains for local runs and tests. The private data repo (`job-scout-data`) holds private config only: `companies.yaml`, `drafting.md`, later `applied.yaml` and the profile.

Job schema (start here, extend as needed): `id` (source + source_id), `source`, `url`, `company`, `title`, `location_text`, `remote` (bool), `posted_at`, `description`, `salary_text`, `apply_url`, `first_seen_at`, then screening fields `tier`, `fit`, `fit_reason`, `eligibility_note`, `dropped_reason`, then `category` (job category from the title: product_manager, product_owner, business_analyst, project_manager, implementation), then review fields: one pipeline `status` (active: new, shortlisted, in_progress, applied, interviewing, offer; closed: skipped, withdrawn, not_moving_forward, accepted, declined), `notes`, `cover_letter`, `answers` (json), `salary_answer`, `applied_at`. Every status change goes in a `status_history` table (job id, from, to, changed_at, note) for the metrics.

## Sources (public only)
Start with three, add more once the pipeline works end to end:
- Himalayas (public jobs API/feed; filter for listings that include Bosnia and Herzegovina)
- Remotive (public API)
- We Work Remotely (RSS, product category)
- Company boards with public JSON: Greenhouse (`boards-api.greenhouse.io/v1/boards/<company>/jobs?content=true`), Lever (`api.lever.co/v0/postings/<company>?mode=json`), Ashby (`api.ashbyhq.com/posting-api/job-board/<company>`). Keep a `config/companies.yaml` watchlist.
Be polite: one request per page, a short delay between requests, a clear User-Agent, cache responses during development.

## Screening rules (patterns in `config/rules.yaml`, choices in the app's Profile page; see docs/decisions.md #013)
Roles: Product Manager / Product Owner first; adjacent roles (business analyst, implementation manager/specialist, technical project manager) second. Drop junior/intern and Staff/Principal/Director/Head/VP.

Tiers:
- Tier 1: Bosnia-based (any workplace type), or remote naming Bosnia or worldwide.
- Tier 2: remote open to Serbia, Croatia, Slovenia, Montenegro, North Macedonia, the Balkans, CEE, or EMEA/Europe with no EU work-permit requirement.
- Tier 3: remote, eligibility unclear.
- Drop: requires EU/UK/US work authorization or residence in a specific country; hybrid/on-site outside Bosnia; betting, gambling, iGaming, alcohol, tobacco, cannabis or drug companies; companies already applied to (`config/applied.yaml`).

Fit: 0-100 against `config/profile.md` (a skills-only profile). Keep fit >= 50 at the Gemini stage (it's rougher), shortlist the top 10 by tier then fit.

Gemini output must be strict JSON validated with a schema (pydantic). On invalid output, retry once, then mark `screening_error` and move on.

## Privacy and secrets
- Gemini free tier may use inputs to improve Google's products. Screening sends Gemini only job text and the anonymized experience from the profile. Drafting may also send the current CV, only when the owner's "Let Gemini read my CV" switch (profile `preferences.ai.allow_cv`) is on, and always with name, email, phone and profile links stripped first. The owner opted in to this on 2026-11-26. Application facts (notice period, authorization, links) are filled in by the app and never sent to a model. Collecting never sends anything.
- The full CV and contact details never go in the repo. Keep them in `private/` (gitignored) for the drafting step only.
- Secrets live in GitHub Actions secrets and Vercel env vars: `GEMINI_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` (and `ANTHROPIC_API_KEY` only if drafting is picked up). Never print or commit them. Provide `.env.example`.

## Drafting rules (step 4)
Cover-letter style rules and salary targets are private. They live in `drafting.md` in the private data repo (`job-scout-data`), and the drafting step reads them from that checkout. Don't copy them into this repo.

## Engineering conventions
- Python: `uv` for deps, `ruff` for lint/format, `pytest` with saved fixture responses per source (no live calls in tests).
- One module per source with a common interface: `fetch() -> list[RawJob]`, `normalize(raw) -> Job`.
- Idempotent runs: running twice in a day adds nothing new.
- Log a one-line summary per run: fetched, new, dropped (by reason), shortlisted, errors per source.
- Small commits with clear messages. Update `README.md` and `docs/decisions.md` (short ADR-style notes) when a design choice is made.

## First task
Step 1 only: repo scaffold, three sources (Himalayas, Remotive, We Work Remotely), normalization, dedupe, SQLite storage, a `make run` / `uv run python -m collector` entry point, tests with fixtures, and the GitHub Actions workflow (manual trigger plus daily cron) that commits `data/`. Stop and show a sample run summary before starting screening.
