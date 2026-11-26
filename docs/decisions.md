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
