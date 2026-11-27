# Decisions

Short ADR-style notes. Newest at the bottom.

## 001. Collector first, every step usable on its own
**Date:** 2026-11-25
The pipeline is built in order: collector, screening, review app, drafting, metrics. Each step writes to the same `jobs` table, so a step can run without the ones after it. The collector on its own already gives a deduplicated daily list in `data/jobs.sqlite`.

## 002. SQLite committed by CI until the review app exists
**Date:** 2026-11-25
`jobs.sqlite` is committed by the GitHub Action after each run (to the private data repo, see 008). No server, no credentials, and the history is in git. The table already has the screening and review columns (null for now) so the move to Supabase in step 3 is a straight copy.
Trade-off: git stores a new copy of the binary file on every run that adds jobs. At current volumes (tens of new rows a day) that is a few MB a month, acceptable until the Supabase migration.

## 003. One module per source, fetch and normalize split
**Date:** 2026-11-25
Each source in `collector/sources/` has `fetch() -> list[RawJob]` (all network) and `normalize(raw) -> Job` (pure). Tests feed saved responses through a fake client, so there are no live calls in tests and normalization can be tested without HTTP.

## 004. Dedupe on id, then on a loose company + title key
**Date:** 2026-11-25
Primary key is `<source>:<source_id>`, so rerunning a day is a no-op. A second check on a normalized `company|title` key (lowercased, legal suffixes, "remote" and gender markers like "(m/f/d)" removed) catches the same role reposted on one board or cross-posted on another. The first board to report a role keeps it.
Text in parentheses is kept. A first version dropped it and merged "Enablement Manager (US)" with "(Europe)" and two ThriveCart roles for different products. A false match can drop the one variant open to Bosnia, while a missed duplicate only costs one extra screening call, so the key errs toward keeping listings apart.

## 005. Himalayas: search endpoint filtered by country
**Date:** 2026-11-25
The search endpoint takes `country=Bosnia and Herzegovina` and returns listings open to Bosnia plus unrestricted (worldwide) ones. The collector re-checks `locationRestrictions` client-side so a listing that doesn't include Bosnia never gets stored. Job slugs are not unique on their own (`manager-product-manager`), so `source_id` is `<company-slug>/<job-slug>`.
Long country lists (often 50-150 entries) are stored in `extra.location_restrictions`; `location_text` gets a short form such as "148 countries (includes Bosnia and Herzegovina)" to keep screening prompts small.

## 006. Remotive: one call, no filters
**Date:** 2026-11-25
As of November 2026 the public Remotive endpoint ignores `category`, `search` and `limit` and returns the same ~16 recent jobs (delayed 24h), across all categories. The collector makes one call a day and stores everything; screening does the filtering. Expect a low yield. Remotive's terms ask that listings link back to Remotive and credit it, so `url` always points at remotive.com.

## 007. HTML stripped at collection time
**Date:** 2026-11-25
Descriptions are converted to plain text (paragraph and list breaks kept) with the stdlib HTML parser. Screening sends text to Gemini, and plain text is a fraction of the tokens.

## 008. Public code, private data repo
**Date:** 2026-11-25
The code repo is public as a portfolio piece. The data goes to a separate private repo (`job-scout-data`) that the workflow checks out with a fine-grained token scoped to that repo.
Reasons: job descriptions belong to the boards (Remotive's terms forbid republishing its listings), and from step 2 on the data includes where applications went, fit notes, drafts and salary answers. Keeping one private repo from day one also keeps those copies out of the public repo's git history, which a later "flip to public" would expose.
Private inputs that arrive in later steps (`config/applied.yaml`, the real profile) live in the data repo too. The public repo keeps `.example` versions. The data repo can be archived once Supabase takes over in step 3.

## 009. Rule-based prefilter in the collector, before anything is stored
**Date:** 2026-11-26
Most listings fail on things a regex can see: wrong role, wrong seniority, US-only, hybrid. Checking those with Gemini would burn free-tier quota on obvious drops, so `collector/prefilter.py` applies `config/rules.yaml` first. Stages run in order (title, remote, location, authorization) and the first failure is the drop reason. Counts after each stage and drops by reason are logged per source and saved in the `runs` table.
Only jobs that pass are stored, which also keeps the committed database small. Rows stored before the prefilter existed get `dropped_reason` set the next time they are fetched, so screening can skip them.
Location rules: Bosnia, Serbia, Croatia, Europe/European, EMEA, CET or UTC+1/+2 make a job eligible, and win over anything else in the location. "Worldwide"/"Anywhere" counts only when no other specific place is named ("Anywhere in the World, United States" is US-only). A plain "Remote" falls back to the description. Restrictions in the title ("(EU only)") override a board's country list. "EU"/"European Union" on its own is treated as EU-only, since that usually means EU residence or a permit.
Known gaps against the tiers in CLAUDE.md: a location naming only Slovenia, Montenegro, North Macedonia, "Balkans" or "CEE" is dropped, and a plain "Remote" with no region in the text is dropped as `unclear` instead of reaching tier 3. Both are one line in `rules.yaml` to change.

## 010. Review app before screening, magic-link login, drafting deferred
**Date:** 2026-11-26
The collector already produces a backlog worth browsing, and the status history behind the metrics only exists once statuses are tracked, so the review app comes before screening. Screening later fills tier and fit columns the app already shows.
Statuses are one pipeline field (new, shortlisted, in_progress, applied, interviewing, offer; closed: skipped, withdrawn, not_moving_forward, accepted, declined) with a `status_history` table, replacing the separate `status` and `reply` fields first planned. Login is a Supabase magic link for one account, public sign-ups off; row-level security is the actual access control, since the browser key is public.
Drafting with the Claude API is deferred: the daily pipeline (collector, prefilter, Gemini screening) runs with no paid model.

## 011. Company boards via ATS detection, watchlist kept private
**Date:** 2026-11-26
Remote-friendly companies mostly post on an applicant tracking system with a public job feed, and those listings are first-hand and complete. The watchlist starts from Remoteur's list of remote companies (947 after deduping by website, since names collide: "CRISP" and "Crisp" are different companies). `scripts/detect_ats.py` finds each company's ATS and board slug from its careers page: links and embeds first, then one careers link, then, if the page names an ATS that loads by JavaScript, a guessed slug confirmed against that ATS's public API. Login-walled boards (angel.co) and bot-protected sites are not fetched.
Result on the first run: 285 of 947 companies on a readable ATS (Ashby 98, Greenhouse 69, Workable 33, Lever 27, Recruitee 23, Teamtailor 21, Breezy 6, Personio 6, SmartRecruiters 2). Matches whose slug had nothing to do with the company were reviewed by hand: real rebrands and acquisitions keep the board with a `board_name` (Gatsby's board is Netlify's), the rest are locked as `unknown` with a note, so no job is ever filed under the wrong company.
A remote ATS job that names one country ("Remote, India") is treated as limited to that country, the same rule as the job boards. Some of those are only an HQ address, so this errs on the strict side. Request URLs are not logged in CI, because the public Actions log would otherwise list the whole watchlist.

## 012. Supabase as the single store; review app on Vercel
**Date:** 2026-11-26
Jobs move from SQLite-in-git to Supabase Postgres so the review app and the collector share one database. The collector writes over Supabase's REST API with the secret key (GitHub's runners can't reach the IPv6-only direct connection) and batches lookups and inserts per source. SQLite stays as the backend for local runs and tests (`--db`).
Access control is in the database, not the app: row-level security on every table, an `app_owner` table that names the one account allowed in (managed by hand, so no email sits in the public repo), column grants that let the app edit only `notes`, and a `change_status()` function as the only way to change status, which also writes `status_history`. The app gets only the publishable key; the login page cannot create accounts (`shouldCreateUser: false`, sign-ups off in Supabase).
The daily loop no longer marks old rows as dropped one by one (thousands of calls against a remote API). `python -m collector.refilter` re-applies the rules to unscreened rows when the rules change.
The app is Next.js 15 (App Router, `@supabase/ssr`), deployed from `app/`. Filters run in the database: category, location match, source, status, posted date, approximate EUR/month salary, and full-text search over title, company and description.

## 013. The profile drives the prefilter
**Date:** 2026-11-26
Search preferences moved from config files to the app's Profile page, stored in Supabase. `config/rules.yaml` keeps the patterns (how "EMEA" or "Staff" is spotted, as named groups); `collector/profile_rules.py` turns the profile into the rules for one run: which categories and seniority levels apply, whether hybrid or on-site work in Sarajevo is fine, which location groups count (core ones plus optional Slovenia, Montenegro, North Macedonia, Balkans, CEE, and plain "Remote" kept as `unclear` for screening), and a company skip list as a new first stage.
Each run loads the profile, then re-applies it to the stored, unscreened backlog before collecting: jobs that no longer fit get a `dropped_reason`, and jobs the prefilter dropped earlier that fit now are restored. Drops from later stages (screening) are never undone. A preference change therefore takes effect on the next run, with the counts shown on the Runs page; there is no in-app "re-check now" button, because the prefilter is Python and runs in Actions.
If the profile can't be read, the run falls back to rules.yaml and records that in the run's `_meta`, instead of failing.

## 014. Drafting with Gemini Flash-Lite, rules checked in code
**Date:** 2026-11-26
Drafting (step 4) runs on the free Gemini tier instead of the Claude API. The job page's Application kit drafts a cover letter and answers to application questions; the salary suggestion is pure arithmetic from the profile's rates (upper middle of a posted range, never below the floor) and never goes through a model.
What Gemini sees: the posting, the anonymized experience, the writing rules, and the current CV only when the owner's switch allows it, with name, email, phone and links stripped first. Factual questions (sponsorship, authorization, notice, start date, links, location, languages, salary) are answered from the profile by pattern, so a model never guesses a legal answer; personal details are left for the owner to fill in.
Model: `gemini-3.5-flash-lite`. On the free tier in November 2026 the full Flash models were often overloaded (503) or took over a minute, while Flash-Lite answered in about 2 seconds. `GEMINI_MODEL` can name a preferred model; it is tried first with a 25-second limit, then Flash-Lite.
Writing rules are enforced where code can check them (length, dashes, "not just X but Y" and two-sentence pivots, "rather than", tricolons, wrap-ups, platitudes, buzzwords, same-length paragraphs): a failing draft is sent back once with the problems listed, and anything left shows as a warning next to the editable letter. In a first test on a real posting, the retry fixed a buzzword but one list of three remained, which the owner edits by hand.

## 015. Screening: rate everything, hide only on eligibility, shortlist by threshold
**Date:** 2026-11-26
`python -m screening` runs in the daily workflow after collection. Gemini (Flash-Lite, 5 jobs per request) rates each new, unscreened job: tier 1, 2 or 3 (the eligibility tiers in CLAUDE.md), fit 0 to 100 against the anonymized experience, a one-line reason and an eligibility note. Answers are validated with pydantic; a bad batch is retried once, then its jobs get `screening_error` and are retried the next day. A busy or rate-limited model is retried after 5 and 15 seconds; if it is still unavailable the run stops and the rest waits.
Only eligibility hides a job: a drop must name a category, and only work_permit, location, onsite and industry set `dropped_reason` (`screening:...`, which the backlog re-check never undoes). A "requirement" verdict (a hard requirement he seems to lack) keeps the job visible with fit capped at 40, because in testing Flash-Lite dropped jobs for weak fit ("lacks top-tier consulting experience") despite the prompt forbidding it.
No top-N cut: with 5 to 20 new jobs a day after the prefilter, a top 10 would be most of them. Instead tier 1 or 2 with fit of at least 60 becomes `shortlisted` (both numbers in `config/rules.yaml`), shown in the Backlog's Shortlist view with Start (to In progress, so onto the Pipeline) and Skip. The Pipeline is unchanged. The day a job was shortlisted is not shown separately: it is the day it was found.
Screening sends job text, the anonymized experience and a summary of target roles and work types; never the CV, application facts or salary numbers.
A bug found while testing screening: the HTTP client dropped query strings already in a URL (httpx.URL(url, params=None)), so Greenhouse jobs had no descriptions and Ashby jobs no salaries. Fixed, with a regression test, and the store now fills in a missing description or salary on known jobs when the source provides it.

## 016. Daily trigger from Vercel Cron, GitHub schedule as fallback
**Date:** 2026-11-27
GitHub's scheduled runs were hours late (17:51 instead of 07:30 UTC) or skipped. Vercel Cron calls `/api/cron/collect` at 07:30 UTC, which starts the workflow with the app's GitHub token; the request must carry `CRON_SECRET`. The workflow's own schedule (09:17 UTC) stays as a fallback and skips itself if a run already happened that day.

## 017. LinkedIn through the owner's Notion "Applications" database
**Date:** 2026-11-27
LinkedIn stays out of the collector (no scraping). Instead the owner saves jobs to the Notion database already used for tracking (Web Clipper, or Share from the LinkedIn app), and `python -m notion_sync` imports it each run, between collection and screening, with a read-only integration shared with that one database.
No stage or only "Ready to Apply" means saved: a job in the Backlog (source `notion`) that screening scores and always puts in To apply, never hidden, since the owner chose it (an eligibility problem becomes a "Check:" note). A page with a stage maps as in the first import (Applied, Interview/Screening, Offered, Signed, Won't be moving forward). Stages only move a job forward or close it, never backwards, and a job closed in the app is never reopened. A page matching a job another source found (same link, or company and title) updates that job instead of adding a copy. Already-imported pages (`notion:<page id>`) are recognized, and only pages from 2026 on are read.
The sync writes nothing back to Notion: a write would change each page's "Last edited time", which dates stage changes. `notion_pages` records each page's stages and last edit, so unchanged pages are skipped.
