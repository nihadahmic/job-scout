import Link from "next/link";
import { signOut } from "@/app/actions";
import { StatusSelect } from "@/components/StatusSelect";
import {
  ACTIVE_STATUSES,
  CATEGORY_LABELS,
  CLOSED_STATUSES,
  LOCATION_MATCH_LABELS,
  SOURCE_LABELS,
  STATUS_LABELS,
  daysAgo,
  formatEur,
  type Status,
} from "@/lib/labels";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;
const SORTS = {
  posted: { column: "posted_at", label: "Date posted" },
  found: { column: "first_seen_at", label: "Date found" },
  salary: { column: "salary_max_eur_month", label: "Salary" },
  company: { column: "company", label: "Company" },
} as const;

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
  const view = one(params.view) || "active"; // active | closed | all
  const statuses = list(params.status);
  const categories = list(params.category);
  const sources = list(params.source);
  const matches = list(params.match);
  const posted = one(params.posted); // days
  const minSalary = one(params.salary); // EUR/month
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
      "id, title, company, category, location_text, location_match, salary_text, salary_min_eur_month, salary_max_eur_month, posted_at, first_seen_at, source, status, url, dropped_reason",
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

  const ascending = sortKey === "company";
  query = query
    .order(sort.column, { ascending, nullsFirst: false })
    .order("first_seen_at", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

  const [{ data: jobs, count, error }, { data: owner }, { data: userData }] = await Promise.all([
    query,
    supabase.rpc("is_owner"),
    supabase.auth.getUser(),
  ]);

  const total = count ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pageHref = (n: number) => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) for (const x of list(v)) if (k !== "page") sp.append(k, x);
    sp.set("page", String(n));
    return `/?${sp.toString()}`;
  };

  return (
    <main className="mx-auto max-w-7xl px-4 py-6">
      <header className="mb-5 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">Job Scout</h1>
          <p className="text-sm text-zinc-500">
            {total} {total === 1 ? "job" : "jobs"}
            {view !== "all" && !statuses.length ? ` · ${view}` : ""}
          </p>
        </div>
        <form action={signOut} className="flex items-center gap-2 text-sm text-zinc-500">
          <span className="hidden sm:inline">{userData.user?.email}</span>
          <button className="btn-ghost">Sign out</button>
        </form>
      </header>

      {owner === false && (
        <p className="mb-4 rounded-md bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
          You are signed in, but this account is not the owner, so no jobs are visible.
        </p>
      )}
      {error && (
        <p className="mb-4 rounded-md bg-rose-50 p-3 text-sm text-rose-800 dark:bg-rose-950 dark:text-rose-200">
          {error.message}
        </p>
      )}

      <form className="mb-5 grid grid-cols-2 gap-3 rounded-lg border border-zinc-200 p-3 text-sm md:grid-cols-4 lg:grid-cols-6 dark:border-zinc-800">
        <label className="col-span-2 flex flex-col gap-1 lg:col-span-2">
          <span className="text-xs text-zinc-500">Search</span>
          <input name="q" defaultValue={q} placeholder="title, company, description" className="field" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-zinc-500">View</span>
          <select name="view" defaultValue={view} className="field">
            <option value="active">Active</option>
            <option value="closed">Closed</option>
            <option value="all">All</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-zinc-500">Posted</span>
          <select name="posted" defaultValue={posted} className="field">
            <option value="">Any time</option>
            <option value="3">Last 3 days</option>
            <option value="7">Last 7 days</option>
            <option value="14">Last 14 days</option>
            <option value="30">Last 30 days</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-zinc-500">Min salary (≈ EUR/month)</span>
          <select name="salary" defaultValue={minSalary} className="field">
            <option value="">Any</option>
            {[3000, 4000, 4800, 6000, 8000].map((v) => (
              <option key={v} value={v}>
                {formatEur(v)}+
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-zinc-500">Sort by</span>
          <select name="sort" defaultValue={sortKey} className="field">
            {Object.entries(SORTS).map(([k, s]) => (
              <option key={k} value={k}>
                {s.label}
              </option>
            ))}
          </select>
        </label>

        <Checks name="category" title="Category" options={CATEGORY_LABELS} selected={categories} />
        <Checks name="match" title="Location" options={LOCATION_MATCH_LABELS} selected={matches} />
        <Checks name="status" title="Status" options={STATUS_LABELS} selected={statuses} />
        <Checks name="source" title="Source" options={SOURCE_LABELS} selected={sources} />

        <div className="col-span-2 flex flex-wrap items-end gap-4 md:col-span-4 lg:col-span-6">
          <label className="flex items-center gap-2">
            <input type="checkbox" name="has_salary" value="1" defaultChecked={withSalary} />
            Only with salary
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" name="dropped" value="1" defaultChecked={showDropped} />
            Include prefilter drops
          </label>
          <div className="ml-auto flex gap-2">
            <Link href="/" className="btn-ghost">
              Reset
            </Link>
            <button className="btn">Apply</button>
          </div>
        </div>
      </form>

      <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
        <table className="w-full min-w-[860px] text-sm">
          <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500 dark:bg-zinc-900">
            <tr>
              <th className="px-3 py-2 font-medium">Role</th>
              <th className="px-3 py-2 font-medium">Category</th>
              <th className="px-3 py-2 font-medium">Location</th>
              <th className="px-3 py-2 font-medium">Salary</th>
              <th className="px-3 py-2 font-medium">Posted</th>
              <th className="px-3 py-2 font-medium">Source</th>
              <th className="px-3 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {(jobs ?? []).map((job) => (
              <tr key={job.id} className={job.dropped_reason ? "opacity-50" : ""}>
                <td className="px-3 py-2">
                  <Link href={`/job?id=${encodeURIComponent(job.id)}`} className="font-medium hover:underline">
                    {job.title}
                  </Link>
                  <div className="text-xs text-zinc-500">
                    {job.company}
                    {job.dropped_reason && ` · dropped: ${job.dropped_reason}`}
                  </div>
                </td>
                <td className="px-3 py-2 text-zinc-600 dark:text-zinc-400">
                  {CATEGORY_LABELS[job.category ?? ""] ?? ""}
                </td>
                <td className="max-w-[220px] px-3 py-2">
                  <div className="truncate" title={job.location_text ?? ""}>
                    {job.location_text}
                  </div>
                  <div className="text-xs text-zinc-500">{LOCATION_MATCH_LABELS[job.location_match ?? ""] ?? ""}</div>
                </td>
                <td className="px-3 py-2 whitespace-nowrap">
                  {job.salary_max_eur_month ? (
                    <span title={job.salary_text ?? ""}>
                      {formatEur(job.salary_min_eur_month)}–{formatEur(job.salary_max_eur_month)}
                    </span>
                  ) : (
                    <span className="text-zinc-400">{job.salary_text ? "see post" : ""}</span>
                  )}
                </td>
                <td className="px-3 py-2 whitespace-nowrap text-zinc-600 dark:text-zinc-400">
                  {daysAgo(job.posted_at ?? job.first_seen_at)}
                </td>
                <td className="px-3 py-2 text-zinc-600 dark:text-zinc-400">{SOURCE_LABELS[job.source] ?? job.source}</td>
                <td className="px-3 py-2">
                  <StatusSelect jobId={job.id} status={job.status as Status} />
                </td>
              </tr>
            ))}
            {!jobs?.length && (
              <tr>
                <td colSpan={7} className="px-3 py-10 text-center text-zinc-500">
                  No jobs match these filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

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

function Checks({
  name,
  title,
  options,
  selected,
}: {
  name: string;
  title: string;
  options: Record<string, string>;
  selected: string[];
}) {
  return (
    <details className="col-span-1 lg:col-span-1" open={selected.length > 0}>
      <summary className="cursor-pointer text-xs text-zinc-500">
        {title}
        {selected.length > 0 && ` (${selected.length})`}
      </summary>
      <div className="mt-2 flex max-h-48 flex-col gap-1 overflow-y-auto">
        {Object.entries(options).map(([value, label]) => (
          <label key={value} className="flex items-center gap-2">
            <input type="checkbox" name={name} value={value} defaultChecked={selected.includes(value)} />
            {label}
          </label>
        ))}
      </div>
    </details>
  );
}
