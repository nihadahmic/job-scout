import { Nav } from "@/components/Nav";
import { RunControl } from "@/components/RunControl";
import { SOURCE_LABELS } from "@/lib/labels";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Stats = {
  fetched: number;
  passed?: Record<string, number>;
  dropped?: Record<string, number>;
  new: number;
  known: number;
  duplicate: number;
  errors: number;
  error_messages?: string[];
};

const STAGES = ["company", "title", "remote", "location", "authorization"];

type Meta = {
  profile?: string;
  refilter?: { dropped?: Record<string, number>; restored?: number; skipped?: string };
};

export default async function RunsPage() {
  const supabase = await createClient();
  const { data: runs, error } = await supabase
    .from("runs")
    .select("id, started_at, finished_at, summary")
    .order("started_at", { ascending: false })
    .limit(60);

  return (
    <main className="mx-auto max-w-6xl px-4 py-6">
      <Nav active="/runs" />
      <RunControl />
      <p className="mb-4 text-sm text-zinc-500">
        One row per collector run (daily at 07:30 UTC). Kept = passed every prefilter rule. Expand a run for the
        per-source counts and why jobs were dropped.
      </p>
      {error && <p className="mb-4 text-sm text-rose-600">{error.message}</p>}
      <div className="flex flex-col gap-2">
        {(runs ?? []).map((run) => {
          const { _meta, ...summary } = run.summary as Record<string, Stats> & { _meta?: Meta };
          const meta = (_meta ?? {}) as Meta;
          const sources = Object.entries(summary) as [string, Stats][];
          const reDropped = Object.values(meta.refilter?.dropped ?? {}).reduce((a, b) => a + b, 0);
          const total = (k: keyof Stats) => sources.reduce((s, [, v]) => s + ((v[k] as number) ?? 0), 0);
          const kept = sources.reduce((s, [, v]) => s + (v.passed?.authorization ?? 0), 0);
          // Nothing fetched and errors: something broke. Nothing fetched, no errors: the board was empty.
          const broken = sources.filter(([, v]) => v.fetched === 0 && v.errors > 0).map(([n]) => SOURCE_LABELS[n] ?? n);
          const empty = sources.filter(([, v]) => v.fetched === 0 && !v.errors).map(([n]) => SOURCE_LABELS[n] ?? n);
          const minutes = Math.round((new Date(run.finished_at).getTime() - new Date(run.started_at).getTime()) / 6000) / 10;
          return (
            <details key={run.id} className="rounded-lg border border-zinc-200 dark:border-zinc-800">
              <summary className="flex cursor-pointer flex-wrap items-center gap-x-6 gap-y-1 px-4 py-3 text-sm">
                <span className="w-44 font-medium">
                  {new Date(run.started_at).toLocaleString("en-GB", {
                    timeZone: "Europe/Sarajevo",
                    weekday: "short",
                    day: "numeric",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
                <Num label="fetched" value={total("fetched")} />
                <Num label="kept" value={kept} />
                <Num label="new" value={total("new")} strong />
                <Num label="errors" value={total("errors")} warn={total("errors") > 0} />
                <span className="text-xs text-zinc-500">{minutes} min</span>
                {broken.length > 0 && (
                  <span className="text-xs text-amber-700 dark:text-amber-400">failed: {broken.join(", ")}</span>
                )}
                {empty.length > 0 && <span className="text-xs text-zinc-500">nothing listed on {empty.join(", ")}</span>}
              </summary>
              <div className="overflow-x-auto border-t border-zinc-200 px-4 py-3 dark:border-zinc-800">
                {(meta.profile || meta.refilter) && (
                  <p className="mb-3 text-xs text-zinc-500">
                    {meta.profile}
                    {meta.refilter && !meta.refilter.skipped && (
                      <>
                        {" · "}backlog re-check: {reDropped} dropped, {meta.refilter.restored ?? 0} brought back
                      </>
                    )}
                  </p>
                )}
                <table className="w-full min-w-[760px] text-sm">
                  <thead className="text-left text-xs text-zinc-500">
                    <tr>
                      <th className="pb-1 font-normal">Source</th>
                      <th className="pb-1 text-right font-normal">Fetched</th>
                      {STAGES.map((s) => (
                        <th key={s} className="pb-1 text-right font-normal">
                          {s}
                        </th>
                      ))}
                      <th className="pb-1 text-right font-normal">New</th>
                      <th className="pb-1 text-right font-normal">Known</th>
                      <th className="pb-1 text-right font-normal">Dup</th>
                      <th className="pb-1 text-right font-normal">Errors</th>
                      <th className="pb-1 pl-4 font-normal">Top drop reasons</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sources.map(([name, v]) => (
                      <tr key={name} className="border-t border-zinc-100 align-top dark:border-zinc-800">
                        <td className="py-1">{SOURCE_LABELS[name] ?? name}</td>
                        <td className="py-1 text-right tabular-nums">{v.fetched}</td>
                        {STAGES.map((s) => (
                          <td key={s} className="py-1 text-right tabular-nums text-zinc-600 dark:text-zinc-400">
                            {v.passed?.[s] ?? "–"}
                          </td>
                        ))}
                        <td className="py-1 text-right font-medium tabular-nums">{v.new}</td>
                        <td className="py-1 text-right tabular-nums">{v.known}</td>
                        <td className="py-1 text-right tabular-nums">{v.duplicate}</td>
                        <td className={`py-1 text-right tabular-nums ${v.errors ? "text-rose-600" : ""}`} title={(v.error_messages ?? []).join("\n")}>
                          {v.errors}
                        </td>
                        <td className="py-1 pl-4 text-xs text-zinc-500">
                          {Object.entries(v.dropped ?? {})
                            .sort((a, b) => b[1] - a[1])
                            .slice(0, 3)
                            .map(([r, n]) => `${r} ${n}`)
                            .join(" · ")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          );
        })}
        {!runs?.length && <p className="text-sm text-zinc-500">No runs yet.</p>}
      </div>
    </main>
  );
}

function Num({ label, value, strong, warn }: { label: string; value: number; strong?: boolean; warn?: boolean }) {
  return (
    <span className={`tabular-nums ${warn ? "text-rose-600" : ""}`}>
      <span className={strong ? "font-semibold" : ""}>{value}</span> <span className="text-xs text-zinc-500">{label}</span>
    </span>
  );
}
