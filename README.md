# job-scout

A personal job-search pipeline. It collects remote Product Manager roles from public job boards every morning, screens them with a cheap model, and hands a short daily shortlist to Claude for drafting. A human approves every application. Nothing is submitted automatically.

Built for a Senior PM based in Sarajevo, so "can I actually take this job" (location and work-permit eligibility) matters as much as fit.

## Status

| Step | What | State |
|---|---|---|
| 1 | Collector: public sources, normalize, dedupe, SQLite | **done** |
| 2 | Screening with Gemini Flash (tier + fit, strict JSON) | next |
| 3 | Review app (Next.js + Supabase) | planned |
| 4 | Drafting with Claude (approved roles only) | planned |
| 5 | Weekly metrics by source and tier | planned |

## How it works (step 1)

```
GitHub Actions (07:30 UTC daily)
  └─ python -m collector
       ├─ himalayas       search API, country = Bosnia and Herzegovina
       ├─ remotive        public API
       └─ weworkremotely  product category RSS
            │  fetch() -> RawJob      (network)
            │  normalize() -> Job     (pure)
            │  prefilter              (config/rules.yaml: title, remote, location, authorization)
            ▼
       dedupe (id, then company+title)  →  jobs.sqlite  →  commit to private data repo
```

Each run prints one detail line per source, then a one-line summary:

```
himalayas: fetched=207 title=103 remote=103 location=99 authorization=99 new=91 known=0 dup=8 errors=0 | dropped: title:role=91, title:seniority=13, location:eu_only_in_title=3, ...
collector | himalayas fetched=207 title=103 ... | total ... in_db=…
```

`title=`, `remote=`, `location=`, `authorization=` are how many jobs are still in after each prefilter stage. `known` = already stored from an earlier run, `dup` = same role already stored (reposted, or on another board).

## Run it

Requires [uv](https://docs.astral.sh/uv/).

```bash
uv sync
make run          # collect, write data/jobs.sqlite
make run-cached   # same, but cache HTTP responses in .cache/ (for development)
make test         # pytest against saved fixtures, no network
make lint
```

Options: `uv run python -m collector --only himalayas remotive --db /tmp/test.sqlite`.

## Where the data lives

This repo holds code only. Collected listings, and later screening results and application history, go to a separate **private** repo (`<owner>/job-scout-data` by default). Job descriptions belong to the boards they came from, and an application history isn't something to publish. Local runs write to `data/`, which is gitignored. From step 3 the data moves to Supabase.

To set up the scheduled run:

1. Create the private data repo with a README so it isn't empty: `gh repo create job-scout-data --private --add-readme`.
2. Create a [fine-grained token](https://github.com/settings/personal-access-tokens/new) with access to that repo only and the permission **Contents: read and write**.
3. Add it to this repo as the Actions secret `DATA_REPO_TOKEN`. To use a different repo name, set the Actions variable `DATA_REPO` to `owner/name`.
4. Run the `collect` workflow by hand once from the Actions tab.

The workflow's public run log shows counts only, never listing content.

## Configuration

- `config/sources.yaml`: which sources run, search queries, User-Agent and request delay.
- `config/rules.yaml`: the prefilter (target titles, seniority, remote, allowed locations, work-permit phrases).
- Step 2 adds tiers, `config/profile.md` (skills-only profile) and `applied.yaml` (private).

## Layout

```
collector/
  __main__.py      CLI entry point
  run.py           one run: fetch, normalize, store, summarize
  store.py         SQLite schema and inserts
  http.py          polite client (User-Agent, delay, optional cache)
  text.py          HTML to text, dedupe key, dates
  prefilter.py     rule-based filter applied before storing
  sources/         one module per source
config/            YAML config
data/              local runs only (gitignored)
docs/decisions.md  design decisions
tests/             pytest + saved fixture responses
```

## Ground rules

- Public sources only. No LinkedIn automation in this repo.
- Polite collection: one request per page, a delay between requests, a clear User-Agent, a handful of requests per day.
- No secrets or personal data in the repo. The CV lives in `private/` (gitignored) and is only used by the drafting step.

Design choices are written down in [docs/decisions.md](docs/decisions.md).
