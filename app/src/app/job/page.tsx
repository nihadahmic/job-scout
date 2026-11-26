import Link from "next/link";
import { notFound } from "next/navigation";
import { DraftPanel } from "@/components/DraftPanel";
import { NotesForm, StatusForm } from "@/components/JobActions";
import { Nav } from "@/components/Nav";
import { geminiConfigured } from "@/lib/drafting/gemini";
import { suggestSalary } from "@/lib/drafting/salary";
import type { LetterDraft } from "@/app/job/draft-actions";
import {
  CATEGORY_LABELS,
  CATEGORY_STYLES,
  DEFAULT_CATEGORY_STYLE,
  LOCATION_MATCH_LABELS,
  LOCATION_TAG,
  SOURCE_LABELS,
  STATUS_COLORS,
  STATUS_LABELS,
  TIER_LABELS,
  dateWithAge,
  fitStyle,
  formatDate,
  formatEur,
  type Status,
} from "@/lib/labels";
import { withDefaults } from "@/lib/profile";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
// Drafting with Gemini runs from this page and can take longer than the default limit.
export const maxDuration = 60;

const TABS = { overview: "Overview", kit: "Application kit", history: "History" } as const;
type Tab = keyof typeof TABS;

export default async function JobPage({ searchParams }: { searchParams: Promise<{ id?: string; tab?: string }> }) {
  const { id, tab: tabParam } = await searchParams;
  if (!id) notFound();

  const supabase = await createClient();
  const [{ data: job }, { data: history }, { data: profileRow }, { data: drafts }] = await Promise.all([
    supabase.from("jobs").select("*").eq("id", id).maybeSingle(),
    supabase
      .from("status_history")
      .select("from_status, to_status, note, reason, changed_at")
      .eq("job_id", id)
      .order("changed_at", { ascending: false }),
    supabase.from("profile").select("preferences").maybeSingle(),
    supabase
      .from("letter_drafts")
      .select("id, created_at, kind, body, notes, model, problems")
      .eq("job_id", id)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);
  if (!job) notFound();

  const status = job.status as Status;
  // Jobs you're working on open on the kit; everything else on the overview.
  const defaultTab: Tab = ["in_progress", "shortlisted"].includes(status) ? "kit" : "overview";
  const tab: Tab = tabParam && tabParam in TABS ? (tabParam as Tab) : defaultTab;
  const tabHref = (t: Tab) => `/job?id=${encodeURIComponent(job.id)}&tab=${t}`;

  const salary = suggestSalary(withDefaults(profileRow).preferences.salary, {
    min: job.salary_min_eur_month,
    max: job.salary_max_eur_month,
  });
  const style = CATEGORY_STYLES[job.category ?? ""] ?? DEFAULT_CATEGORY_STYLE;

  const facts: [string, React.ReactNode][] = [
    ["Location", job.location_text || "—"],
    ["Eligible because", LOCATION_MATCH_LABELS[job.location_match ?? ""] ?? "—"],
    [
      "Salary",
      job.salary_text
        ? `${job.salary_text}${job.salary_max_eur_month ? ` (≈ ${formatEur(job.salary_min_eur_month)}–${formatEur(job.salary_max_eur_month)} EUR/month)` : ""}`
        : "Not stated",
    ],
    ["Posted", job.posted_at ? dateWithAge(job.posted_at) : "Not stated"],
    ["Found", dateWithAge(job.first_seen_at)],
    ["Source", SOURCE_LABELS[job.source] ?? job.source],
  ];
  if (job.applied_at) facts.push(["Applied", dateWithAge(job.applied_at)]);
  if (job.close_reason) facts.push(["Closed because", job.close_reason]);
  if (job.dropped_reason) facts.push(["Dropped", job.dropped_reason]);

  return (
    <main className="mx-auto max-w-6xl px-4 py-6">
      <Nav active="" />

      {/* Header */}
      <header className={`mb-5 rounded-xl border border-l-4 border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950 ${style.edge}`}>
        <div className="flex flex-wrap items-start gap-4">
          <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-lg font-semibold ${style.tag}`}>
            {job.company.trim().charAt(0).toUpperCase() || "?"}
          </span>
          <div className="min-w-0 flex-1">
            <Link href="/" className="text-xs text-zinc-500 hover:underline">
              ← Backlog
            </Link>
            <h1 className="text-xl font-semibold leading-tight sm:text-2xl">{job.title}</h1>
            <p className="text-zinc-600 dark:text-zinc-400">
              {job.company}
              {job.location_text ? ` · ${job.location_text}` : ""}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
              <span className={`rounded-full px-2 py-0.5 font-medium ${STATUS_COLORS[status]}`}>{STATUS_LABELS[status]}</span>
              {job.fit != null && (
                <span className={`rounded-full px-2 py-0.5 font-medium ${fitStyle(job.fit)}`} title={job.tier ? TIER_LABELS[String(job.tier)] : ""}>
                  {job.tier ? `Tier ${job.tier} · ` : ""}fit {job.fit}
                </span>
              )}
              {job.category && <span className={`rounded-full px-2 py-0.5 ${style.tag}`}>{CATEGORY_LABELS[job.category]}</span>}
              {job.location_match && <span className={`rounded-full px-2 py-0.5 ${LOCATION_TAG}`}>{LOCATION_MATCH_LABELS[job.location_match]}</span>}
              {job.salary_max_eur_month ? (
                <span className="rounded-full bg-zinc-100 px-2 py-0.5 tabular-nums text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                  {formatEur(job.salary_min_eur_month)}–{formatEur(job.salary_max_eur_month)} /mo
                </span>
              ) : null}
              <span className="rounded-full border border-zinc-200 px-2 py-0.5 text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">
                {SOURCE_LABELS[job.source] ?? job.source}
              </span>
              <span className="text-zinc-500">{job.posted_at ? `Posted ${dateWithAge(job.posted_at)}` : `Found ${dateWithAge(job.first_seen_at)}`}</span>
            </div>
          </div>
          <div className="flex gap-2">
            <a href={job.url} target="_blank" rel="noopener noreferrer" className="btn">
              Open posting ↗
            </a>
            {job.apply_url && job.apply_url !== job.url && (
              <a href={job.apply_url} target="_blank" rel="noopener noreferrer" className="btn-ghost border border-zinc-300 dark:border-zinc-700">
                Apply page ↗
              </a>
            )}
          </div>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0">
          {/* Tabs */}
          <nav className="mb-4 flex gap-1 border-b border-zinc-200 dark:border-zinc-800">
            {(Object.keys(TABS) as Tab[]).map((t) => (
              <Link
                key={t}
                href={tabHref(t)}
                className={`-mb-px border-b-2 px-3 py-2 text-sm ${
                  t === tab
                    ? "border-zinc-900 font-medium dark:border-zinc-100"
                    : "border-transparent text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
                }`}
              >
                {TABS[t]}
                {t === "kit" && job.cover_letter ? <span className="ml-1 text-xs text-emerald-600">●</span> : null}
                {t === "history" && history?.length ? <span className="ml-1 text-xs text-zinc-400">{history.length}</span> : null}
              </Link>
            ))}
          </nav>

          {tab === "overview" && (
            <div className="flex flex-col gap-5">
              {(job.fit_reason || job.eligibility_note) && (
                <section className="rounded-xl bg-zinc-50 p-4 text-sm dark:bg-zinc-900">
                  <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">Screening</h2>
                  {job.fit_reason && <p>{job.fit_reason}</p>}
                  {job.eligibility_note && (
                    <p className={`mt-1 ${job.eligibility_note.startsWith("Requirement:") ? "text-amber-700 dark:text-amber-400" : "text-zinc-600 dark:text-zinc-400"}`}>
                      {job.eligibility_note}
                    </p>
                  )}
                </section>
              )}
              <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                {facts.map(([k, v]) => (
                  <div key={k} className="flex gap-2 border-b border-zinc-100 pb-2 dark:border-zinc-800">
                    <dt className="w-32 shrink-0 text-zinc-500">{k}</dt>
                    <dd className="min-w-0 break-words">{v}</dd>
                  </div>
                ))}
              </dl>
              <section>
                <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">Description</h2>
                <div className="max-w-3xl whitespace-pre-wrap text-sm leading-relaxed">
                  {job.description || <span className="text-zinc-500">No description from this source. Open the posting.</span>}
                </div>
              </section>
            </div>
          )}

          {tab === "kit" && (
            <DraftPanel
              jobId={job.id}
              geminiReady={geminiConfigured()}
              canLoadQuestions={job.source === "greenhouse" || job.source === "recruitee"}
              salary={{ text: salary.text, basis: salary.basis, belowFloor: salary.belowFloor }}
              savedSalary={job.salary_answer}
              savedLetter={job.cover_letter}
              savedAnswers={job.answers}
              drafts={(drafts ?? []) as LetterDraft[]}
            />
          )}

          {tab === "history" && (
            <section>
              {history?.length ? (
                <ol className="relative ml-2 border-l border-zinc-200 dark:border-zinc-800">
                  {history.map((h, i) => (
                    <li key={i} className="mb-4 ml-4">
                      <span className="absolute -left-1.5 mt-1.5 h-3 w-3 rounded-full border-2 border-white bg-zinc-400 dark:border-zinc-950" />
                      <p className="text-xs text-zinc-500">{formatDate(h.changed_at)}</p>
                      <p className="text-sm">
                        {STATUS_LABELS[h.from_status as Status] ?? "Added"} →{" "}
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[h.to_status as Status]}`}>
                          {STATUS_LABELS[h.to_status as Status]}
                        </span>
                      </p>
                      {h.reason && <p className="text-sm text-zinc-700 dark:text-zinc-300">{h.reason}</p>}
                      {h.note && <p className="text-sm text-zinc-600 dark:text-zinc-400">{h.note}</p>}
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-sm text-zinc-500">No status changes yet.</p>
              )}
            </section>
          )}
        </div>

        {/* Sidebar */}
        <aside className="flex flex-col gap-4 lg:sticky lg:top-4 lg:self-start">
          <section className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
            <h2 className="mb-2 text-sm font-semibold">Status</h2>
            <StatusForm jobId={job.id} status={status} closeReason={job.close_reason} />
          </section>
          <section className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
            <h2 className="mb-2 text-sm font-semibold">Notes</h2>
            <NotesForm jobId={job.id} notes={job.notes ?? ""} />
          </section>
        </aside>
      </div>
    </main>
  );
}
