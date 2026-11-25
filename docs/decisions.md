# Decisions

Short ADR-style notes. Newest at the bottom.

## 001. Collector first, every step usable on its own
**Date:** 2026-11-25
The pipeline is built in order: collector, screening, review app, drafting, metrics. Each step writes to the same `jobs` table, so a step can run without the ones after it. The collector on its own already gives a deduplicated daily list in `data/jobs.sqlite`.

## 002. SQLite committed to the repo until the review app exists
**Date:** 2026-11-25
`data/jobs.sqlite` is committed by the GitHub Action after each run. No server, no credentials, and the history is in git. The table already has the screening and review columns (null for now) so the move to Supabase in step 3 is a straight copy.
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
