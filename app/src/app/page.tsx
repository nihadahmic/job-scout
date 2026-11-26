import Link from "next/link";
import { AutoSubmitForm } from "@/components/AutoSubmitForm";
import { Nav } from "@/components/Nav";
import { StatusSelect } from "@/components/StatusSelect";
import {
  ACTIVE_STATUSES,
  CATEGORY_LABELS,
  CATEGORY_STYLES,
  CLOSED_STATUSES,
  DEFAULT_CATEGORY_STYLE,
  LOCATION_MATCH_LABELS,
  LOCATION_TAG,
  SOURCE_LABELS,
  STATUS_LABELS,
  daysAgo,
  formatEur,
  type Status,
} from "@/lib/labels";
import { monthlyFloor, withDefaults } from "@/lib/profile";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;
const SORTS = {
  posted: { column: "posted_at", label: "Newest posted" },
  found: { column: "first_seen_at", label: "Newest found" },
  salary: { column: "salary_max_eur_month", label: "Highest salary" },
  company: { column: "company", label: "Company A–Z" },
} as const;
const VIEWS = { active: "Active", closed: "Closed", all: "All" } as const;
const POSTED = { "": "Any time", "3": "3 days", "7": "7 days", "14": "14 days", "30": "30 days" } as const;
const SALARY_STEPS = [3000, 4000, 5000, 6000, 8000];


type Params = Record<string, string | string[] | undefined>;

function list(value: string | string[] | undefined): string[] {
  if (!value) return [];
  return (Array.isArray(value) ? value : [value]).filter(Boolean);
}

function one(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

export default async function BacklogPage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const view = (one(params.view) || "active") as keyof typeof VIEWS;
  const statuses = list(params.status);
  const categories = list(params.category);
  const sources = list(params.source);
  const matches = list(params.match);
  const posted = one(params.posted);
  const minSalary = one(params.salary);
  const withSalary = one(params.has_salary) === "1";
  const showDropped = one(params.dropped) === "1";
  const q = one(params.q).trim();
  const sortKey = (one(params.sort) || "posted") as keyof typeof SORTS;
  const sort = SORTS[sortKey] ?? SORTS.posted;
  const page = Math.max(1, Number(one(params.page)) || 1);

  const supabase = await createClient();
  let query = supabase
    .from("jobs")
    .select(
      "id, title, company, category, location_text, location_match, salary_text, salary_min_eur_month, salary_max_eur_month, posted_at, first_seen_at, source, status, dropped_reason",
      { count: "exact" },
    );
  if (statuses.length) query = query.in("status", statuses);
  else if (view === "active") query = query.in("status", [...ACTIVE_STATUSES]);
  else if (view === "closed") query = query.in("status", [...CLOSED_STATUSES]);
  if (!showDropped) query = query.is("dropped_reason", null);
  if (categories.length) query = query.in("category", categories);
  if (sources.length) query = query.in("source", sources);
  if (matches.length) query = query.in("location_match", matches);
  if (posted) query = query.gte("posted_at", new Date(Date.now() - Number(posted) * 86_400_000).toISOString());
  if (minSalary) query = query.gte("salary_max_eur_month", Number(minSalary));
  else if (withSalary) query = query.not("salary_max_eur_month", "is", null);
  if (q) query = query.textSearch("search", q, { type: "websearch", config: "english" });
  query = query
    .order(sort.column, { ascending: sortKey === "company", nullsFirst: false })
    .order("first_seen_at", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

  const [{ data: jobs, count, error }, { data: owner }, { data: profileRow }] = await Promise.all([
    query,
    supabase.rpc("is_owner"),
    supabase.from("profile").select("preferences").maybeSingle(),
  ]);
  // Highlights salaries at or above the floor set on the Profile page.
  const salaryFloor = monthlyFloor(withDefaults(profileRow).preferences);
  const total = count ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pageHref = (n: number) => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) for (const x of list(v)) if (k !== "page") sp.append(k, x);
    sp.set("page", String(n));
    return `/?${sp.toString()}`;
  };
  const anyFilter =
    statuses.length + categories.length + sources.length + matches.length > 0 ||
    !!posted || !!minSalary || withSalary || showDropped || !!q || view !== "active";

  return (
    <main className="mx-auto max-w-6xl px-4 py-6">
      <Nav active="/" />

      {owner === false && (
        <p className="mb-4 rounded-md bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
          You are signed in, but this account is not the owner, so no jobs are visible.
        </p>
      )}
      {error && (
        <p className="mb-4 rounded-md bg-rose-50 p-3 text-sm text-rose-800 dark:bg-rose-950 dark:text-rose-200">{error.message}</p>
      )}

      <AutoSubmitForm className="mb-4 flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="Search title, company or description, then press Enter"
            className="field min-w-0 flex-1 py-2"
          />
          <Segment name="view" options={VIEWS} value={view} />
          <select name="sort" defaultValue={sortKey} aria-label="Sort" className="field py-2">
            {Object.entries(SORTS).map(([k, s]) => (
              <option key={k} value={k}>
                {s.label}
              </option>
            ))}
          </select>
        </div>

        <ChipRow label="Category">
          {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
            <Chip key={value} name="category" value={value} checked={categories.includes(value)} on={(CATEGORY_STYLES[value] ?? DEFAULT_CATEGORY_STYLE).tag}>
              {label}
            </Chip>
          ))}
        </ChipRow>
        <ChipRow label="Location">
          {Object.entries(LOCATION_MATCH_LABELS).map(([value, label]) => (
            <Chip key={value} name="match" value={value} checked={matches.includes(value)} on={LOCATION_TAG}>
              {label}
            </Chip>
          ))}
        </ChipRow>
        <ChipRow label="Posted">
          {Object.entries(POSTED).map(([value, label]) => (
            <Chip key={value || "any"} type="radio" name="posted" value={value} checked={posted === value}>
              {label}
            </Chip>
          ))}
        </ChipRow>
        <ChipRow label="Salary">
          <Chip type="radio" name="salary" value="" checked={!minSalary}>
            Any
          </Chip>
          {SALARY_STEPS.map((v) => (
            <Chip key={v} type="radio" name="salary" value={String(v)} checked={minSalary === String(v)} on="bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
              {formatEur(v)}+ /mo
            </Chip>
          ))}
          <Chip name="has_salary" value="1" checked={withSalary}>
            Only with salary
          </Chip>
        </ChipRow>

        <details className="text-sm" open={statuses.length + sources.length > 0 || showDropped}>
          <summary className="cursor-pointer text-xs text-zinc-500">
            More filters{statuses.length + sources.length > 0 ? ` (${statuses.length + sources.length})` : ""}
          </summary>
          <div className="mt-2 flex flex-col gap-3">
            <ChipRow label="Status">
              {Object.entries(STATUS_LABELS).map(([value, label]) => (
                <Chip key={value} name="status" value={value} checked={statuses.includes(value)}>
                  {label}
                </Chip>
              ))}
            </ChipRow>
            <ChipRow label="Source">
              {Object.entries(SOURCE_LABELS).map(([value, label]) => (
                <Chip key={value} name="source" value={value} checked={sources.includes(value)}>
                  {label}
                </Chip>
              ))}
            </ChipRow>
            <ChipRow label="Other">
              <Chip name="dropped" value="1" checked={showDropped}>
                Include prefilter drops
              </Chip>
            </ChipRow>
          </div>
        </details>
        <noscript>
          <button className="btn self-start">Apply</button>
        </noscript>
      </AutoSubmitForm>

      <div className="mb-2 flex items-baseline justify-between text-sm">
        <p className="text-zinc-500">
          <span className="font-medium text-zinc-900 dark:text-zinc-100">{total}</span> {total === 1 ? "job" : "jobs"}
          {sortKey === "posted" ? ", newest first" : ""}
        </p>
        {anyFilter && (
          <Link href="/" className="text-xs text-zinc-500 hover:underline">
            Clear filters
          </Link>
        )}
      </div>

      <ul className="flex flex-col gap-1.5">
        {(jobs ?? []).map((job) => {
          const style = CATEGORY_STYLES[job.category ?? ""] ?? DEFAULT_CATEGORY_STYLE;
          const isNew = Date.now() - new Date(job.first_seen_at).getTime() < 86_400_000;
          const aboveFloor = salaryFloor != null && (job.salary_max_eur_month ?? 0) >= salaryFloor;
          return (
            <li
              key={job.id}
              className={`flex flex-col gap-2 rounded-md border border-l-4 border-zinc-200 bg-white p-3 sm:flex-row sm:items-center sm:gap-4 dark:border-zinc-800 dark:bg-zinc-950 ${style.edge} ${job.dropped_reason ? "opacity-60" : ""}`}
            >
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-sm font-semibold ${style.tag}`}>
                  {job.company.trim().charAt(0).toUpperCase() || "?"}
                </span>
                <div className="min-w-0">
                  <Link href={`/job?id=${encodeURIComponent(job.id)}`} className="font-medium hover:underline">
                    {job.title}
                  </Link>
                  {isNew && (
                    <span className="ml-2 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[11px] font-medium text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                      New today
                    </span>
                  )}
                  <p className="truncate text-sm text-zinc-500">
                    {job.company}
                    {job.location_text ? ` · ${job.location_text}` : ""}
                    {job.dropped_reason ? ` · dropped: ${job.dropped_reason}` : ""}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-1.5 text-xs sm:justify-end">
                {job.category && <span className={`rounded-full px-2 py-0.5 ${style.tag}`}>{CATEGORY_LABELS[job.category]}</span>}
                {job.location_match && (
                  <span className={`rounded-full px-2 py-0.5 ${LOCATION_TAG}`}>{LOCATION_MATCH_LABELS[job.location_match]}</span>
                )}
                {job.salary_max_eur_month ? (
                  <span
                    title={job.salary_text ?? ""}
                    className={`rounded-full px-2 py-0.5 tabular-nums ${aboveFloor ? "bg-emerald-100 font-medium text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300" : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"}`}
                  >
                    {formatEur(job.salary_min_eur_month)}–{formatEur(job.salary_max_eur_month)}
                  </span>
                ) : null}
                <span className="text-zinc-500" title={SOURCE_LABELS[job.source] ?? job.source}>
                  {daysAgo(job.posted_at ?? job.first_seen_at)}
                </span>
                <StatusSelect jobId={job.id} status={job.status as Status} />
              </div>
            </li>
          );
        })}
        {!jobs?.length && (
          <li className="rounded-md border border-dashed border-zinc-300 p-10 text-center text-sm text-zinc-500 dark:border-zinc-700">
            No jobs match these filters.
          </li>
        )}
      </ul>

      {pages > 1 && (
        <nav className="mt-4 flex items-center justify-between text-sm">
          {page > 1 ? <Link href={pageHref(page - 1)} className="btn-ghost">← Previous</Link> : <span />}
          <span className="text-zinc-500">
            Page {page} of {pages}
          </span>
          {page < pages ? <Link href={pageHref(page + 1)} className="btn-ghost">Next →</Link> : <span />}
        </nav>
      )}
    </main>
  );
}

function ChipRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="w-16 shrink-0 text-xs text-zinc-500">{label}</span>
      {children}
    </div>
  );
}

function Chip({
  name,
  value,
  checked,
  children,
  type = "checkbox",
  on = "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900",
}: {
  name: string;
  value: string;
  checked: boolean;
  children: React.ReactNode;
  type?: "checkbox" | "radio";
  on?: string;
}) {
  return (
    <label
      className={`cursor-pointer select-none rounded-full border px-2.5 py-1 text-xs transition-colors ${
        checked
          ? `${on} border-transparent font-medium`
          : "border-zinc-300 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
      }`}
    >
      <input type={type} name={name} value={value} defaultChecked={checked} className="sr-only" />
      {children}
    </label>
  );
}

function Segment({ name, options, value }: { name: string; options: Record<string, string>; value: string }) {
  return (
    <div className="flex rounded-md border border-zinc-300 p-0.5 text-sm dark:border-zinc-700">
      {Object.entries(options).map(([k, label]) => (
        <label
          key={k}
          className={`cursor-pointer rounded px-2.5 py-1 ${k === value ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "text-zinc-600 dark:text-zinc-400"}`}
        >
          <input type="radio" name={name} value={k} defaultChecked={k === value} className="sr-only" />
          {label}
        </label>
      ))}
    </div>
  );
}
