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
            ▼
       dedupe (id, then company+title)  →  data/jobs.sqlite  →  git commit
```

Each run prints one line:

```
collector | himalayas fetched=… new=… known=… dup=… errors=… | remotive … | weworkremotely … | total … in_db=…
```

`known` = already stored from an earlier run, `dup` = same role already stored from another board.

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

## Configuration

- `config/sources.yaml`: which sources run, search queries, User-Agent and request delay.
- Step 2 adds `config/rules.yaml` (tiers, drops), `config/profile.md` (skills-only profile) and `config/applied.yaml`.

## Layout

```
collector/
  __main__.py      CLI entry point
  run.py           one run: fetch, normalize, store, summarize
  store.py         SQLite schema and inserts
  http.py          polite client (User-Agent, delay, optional cache)
  text.py          HTML to text, dedupe key, dates
  sources/         one module per source
config/            YAML config
data/              jobs.sqlite (committed by CI)
docs/decisions.md  design decisions
tests/             pytest + saved fixture responses
```

## Ground rules

- Public sources only. No LinkedIn automation in this repo.
- Polite collection: one request per page, a delay between requests, a clear User-Agent, a handful of requests per day.
- No secrets or personal data in the repo. The CV lives in `private/` (gitignored) and is only used by the drafting step.

Design choices are written down in [docs/decisions.md](docs/decisions.md).
