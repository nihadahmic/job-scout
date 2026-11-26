import Link from "next/link";
import { notFound } from "next/navigation";
import { DraftPanel } from "@/components/DraftPanel";
import { NotesForm, StatusForm } from "@/components/JobActions";
import { geminiConfigured } from "@/lib/drafting/gemini";
import { suggestSalary } from "@/lib/drafting/salary";
import { withDefaults } from "@/lib/profile";
import { Nav } from "@/components/Nav";
import {
  CATEGORY_LABELS,
  LOCATION_MATCH_LABELS,
  SOURCE_LABELS,
  STATUS_COLORS,
  STATUS_LABELS,
  formatDate,
  formatEur,
  type Status,
} from "@/lib/labels";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
// Drafting with Gemini runs from this page and can take longer than the default limit.
export const maxDuration = 60;

export default async function JobPage({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  const { id } = await searchParams;
  if (!id) notFound();

  const supabase = await createClient();
  const [{ data: job }, { data: history }, { data: profileRow }] = await Promise.all([
    supabase.from("jobs").select("*").eq("id", id).maybeSingle(),
    supabase
      .from("status_history")
      .select("from_status, to_status, note, reason, changed_at")
      .eq("job_id", id)
      .order("changed_at", { ascending: false }),
    supabase.from("profile").select("preferences").maybeSingle(),
  ]);
  if (!job) notFound();

  const status = job.status as Status;
  const salary = suggestSalary(withDefaults(profileRow).preferences.salary, {
    min: job.salary_min_eur_month,
    max: job.salary_max_eur_month,
  });
  const facts: [string, React.ReactNode][] = [
    ["Category", CATEGORY_LABELS[job.category ?? ""] ?? "—"],
    ["Location", job.location_text || "—"],
    ["Why it passed", LOCATION_MATCH_LABELS[job.location_match ?? ""] ?? "—"],
    [
      "Salary",
      job.salary_text
        ? `${job.salary_text}${job.salary_max_eur_month ? ` (≈ ${formatEur(job.salary_min_eur_month)}–${formatEur(job.salary_max_eur_month)} EUR/month)` : ""}`
        : "—",
    ],
    ["Posted", formatDate(job.posted_at) || "—"],
    ["Found", formatDate(job.first_seen_at)],
    ["Source", SOURCE_LABELS[job.source] ?? job.source],
  ];
  if (job.close_reason) facts.push(["Closed because", job.close_reason]);
  if (job.dropped_reason) facts.push(["Prefilter", `dropped: ${job.dropped_reason}`]);
  if (job.tier != null) facts.push(["Tier / fit", `${job.tier} / ${job.fit ?? "—"}`]);

  return (
    <main className="mx-auto max-w-5xl px-4 py-6">
      <Nav active="" />
      <Link href="/" className="text-sm text-zinc-500 hover:underline">
        ← Backlog
      </Link>
      <header className="mt-3 mb-6">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">{job.title}</h1>
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[status]}`}>
            {STATUS_LABELS[status]}
          </span>
        </div>
        <p className="text-zinc-600 dark:text-zinc-400">{job.company}</p>
        <div className="mt-3 flex gap-2">
          <a href={job.url} target="_blank" rel="noopener noreferrer" className="btn-ghost border border-zinc-300 dark:border-zinc-700">
            Open posting ↗
          </a>
          {job.apply_url && job.apply_url !== job.url && (
            <a href={job.apply_url} target="_blank" rel="noopener noreferrer" className="btn-ghost border border-zinc-300 dark:border-zinc-700">
              Apply page ↗
            </a>
          )}
        </div>
      </header>

      <div className="grid gap-8 md:grid-cols-[1fr_320px]">
        <section className="order-2 flex flex-col gap-6 md:order-1">
          <DraftPanel
            jobId={job.id}
            geminiReady={geminiConfigured()}
            canLoadQuestions={job.source === "greenhouse" || job.source === "recruitee"}
            salary={{ text: salary.text, basis: salary.basis, belowFloor: salary.belowFloor }}
            savedSalary={job.salary_answer}
            savedLetter={job.cover_letter}
            savedAnswers={job.answers}
          />
          <div>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-zinc-500">Description</h2>
          <div className="whitespace-pre-wrap text-sm leading-relaxed">
            {job.description || <span className="text-zinc-500">No description from this source. Open the posting.</span>}
          </div>
          </div>
        </section>

        <aside className="order-1 flex flex-col gap-6 md:order-2">
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm">
            {facts.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-zinc-500">{k}</dt>
                <dd className="break-words">{v}</dd>
              </div>
            ))}
          </dl>

          <section>
            <h2 className="mb-2 text-sm font-semibold">Status</h2>
            <StatusForm jobId={job.id} status={status} closeReason={job.close_reason} />
          </section>

          <section>
            <h2 className="mb-2 text-sm font-semibold">Notes</h2>
            <NotesForm jobId={job.id} notes={job.notes ?? ""} />
          </section>

          <section>
            <h2 className="mb-2 text-sm font-semibold">History</h2>
            {history?.length ? (
              <ol className="flex flex-col gap-2 text-sm">
                {history.map((h, i) => (
                  <li key={i}>
                    <span className="text-zinc-500">{formatDate(h.changed_at)}</span>{" "}
                    {STATUS_LABELS[h.from_status as Status] ?? "—"} → {STATUS_LABELS[h.to_status as Status]}
                    {h.reason && <div className="text-zinc-700 dark:text-zinc-300">{h.reason}</div>}
                    {h.note && <div className="text-zinc-600 dark:text-zinc-400">{h.note}</div>}
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-sm text-zinc-500">No changes yet.</p>
            )}
          </section>
        </aside>
      </div>
    </main>
  );
}
