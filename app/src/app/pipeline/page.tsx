import Link from "next/link";
import { Board, type BoardJob } from "@/components/Board";
import { Nav } from "@/components/Nav";
import type { Status } from "@/lib/labels";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const FOLLOW_UP_DAYS = 10;
const ACTIVE: Status[] = ["in_progress", "applied", "interviewing", "offer", "accepted"];
const CLOSED: Status[] = ["not_moving_forward", "withdrawn", "declined"];

export default async function PipelinePage({ searchParams }: { searchParams: Promise<{ closed?: string }> }) {
  const { closed } = await searchParams;
  const allClosed = closed === "all";
  const supabase = await createClient();
  const cols = "id, company, title, category, status, close_reason, status_changed_at, applied_at, first_seen_at";

  let closedQuery = supabase.from("jobs").select(cols).in("status", CLOSED).order("status_changed_at", { ascending: false });
  if (!allClosed) closedQuery = closedQuery.gte("status_changed_at", new Date(Date.now() - 30 * 86_400_000).toISOString());

  const [active, closedJobs, closedTotal] = await Promise.all([
    supabase.from("jobs").select(cols).in("status", ACTIVE).order("status_changed_at", { ascending: false }).limit(1000),
    closedQuery.limit(1000),
    supabase.from("jobs").select("id", { count: "exact", head: true }).in("status", CLOSED),
  ]);
  const error = active.error ?? closedJobs.error;

  const toCard = (j: NonNullable<typeof active.data>[number]): BoardJob => {
    const since = j.status_changed_at ?? j.applied_at ?? j.first_seen_at;
    const days = Math.floor((Date.now() - new Date(since).getTime()) / 86_400_000);
    return {
      id: j.id,
      company: j.company,
      title: j.title,
      category: j.category,
      status: j.status as Status,
      close_reason: j.close_reason,
      since,
      waitingDays: j.status === "applied" ? days : null,
    };
  };
  const jobs = [...(active.data ?? []), ...(closedJobs.data ?? [])].map(toCard);
  const shownClosed = closedJobs.data?.length ?? 0;

  return (
    <main className="mx-auto max-w-[1400px] px-4 py-6">
      <Nav active="/pipeline" />
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2 text-sm text-zinc-500">
        <p>Drag a card to change its status, or use its Move to menu. Every move is saved to the job&apos;s history.</p>
        <p>
          Closed: {allClosed ? "all" : "last 30 days"} ({shownClosed} of {closedTotal.count ?? 0}) ·{" "}
          <Link href={allClosed ? "/pipeline" : "/pipeline?closed=all"} className="underline">
            {allClosed ? "show last 30 days" : "show all"}
          </Link>
        </p>
      </div>
      {error && <p className="mb-4 text-sm text-rose-600">{error.message}</p>}
      <Board jobs={jobs} followUpDays={FOLLOW_UP_DAYS} />
    </main>
  );
}
