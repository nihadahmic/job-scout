"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { getRunStatus, startRun, type RunStatus } from "@/app/runs/run-actions";

const STEP_ICON: Record<RunStatus["steps"][number]["state"], string> = {
  done: "✓",
  running: "●",
  waiting: "○",
  failed: "✕",
  skipped: "–",
};

function minutes(s: number): string {
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return r ? `${m} min ${r}s` : `${m} min`;
}

export function RunControl() {
  const router = useRouter();
  const [status, setStatus] = useState<RunStatus | null>(null);
  const [error, setError] = useState("");
  const [waitingForNewRun, setWaitingForNewRun] = useState<number | null>(null); // id of the run before ours
  const [pending, start] = useTransition();
  const [, tick] = useState(0);
  const wasActive = useRef(false);

  const poll = useCallback(async () => {
    const r = await getRunStatus();
    if (!r.ok) return setError(r.error);
    setError("");
    setStatus(r.status);
    const active = r.status.active;
    if (wasActive.current && !active) router.refresh(); // a run just finished: reload the list below
    wasActive.current = active;
    if (waitingForNewRun !== null && r.status.run && r.status.run.id !== waitingForNewRun) setWaitingForNewRun(null);
  }, [router, waitingForNewRun]);

  useEffect(() => {
    poll();
    const fast = status?.active || waitingForNewRun !== null;
    const id = setInterval(poll, fast ? 5_000 : 30_000);
    return () => clearInterval(id);
  }, [poll, status?.active, waitingForNewRun]);

  // Re-render every second so elapsed time and the estimate count smoothly between polls.
  useEffect(() => {
    if (!status?.active) return;
    const id = setInterval(() => tick((n) => n + 1), 1_000);
    return () => clearInterval(id);
  }, [status?.active]);

  if (status && !status.configured) {
    return (
      <p className="mb-4 rounded-md bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
        To start runs from here, add a <code>GITHUB_TOKEN</code> in Vercel (fine-grained, this repository only, Actions: read
        and write). Runs still happen daily at 07:30 UTC.
      </p>
    );
  }

  const run = status?.run;
  const active = Boolean(status?.active) || waitingForNewRun !== null;
  const liveElapsed =
    status?.active && run?.startedAt ? Math.max(0, Math.round((Date.now() - new Date(run.startedAt).getTime()) / 1000)) : status?.elapsedSeconds ?? 0;
  const typical = status?.typicalSeconds ?? null;
  const remaining = status?.active && typical != null ? Math.max(0, typical - liveElapsed) : null;
  const progress = status?.active && typical ? Math.min(0.97, liveElapsed / typical) : null;
  const eta =
    remaining != null ? new Date(Date.now() + remaining * 1000).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Sarajevo" }) : null;

  return (
    <section className="mb-5 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">
            {waitingForNewRun !== null
              ? "Starting a run…"
              : status?.active
                ? run?.status === "queued"
                  ? "Run queued"
                  : "Run in progress"
                : run
                  ? `Last run ${run.conclusion === "success" ? "finished" : run.conclusion ?? "ended"}`
                  : "No runs yet"}
          </h2>
          <p className="text-xs text-zinc-500">
            {status?.active
              ? `${minutes(liveElapsed)} elapsed${
                  remaining != null
                    ? remaining > 0
                      ? ` · about ${minutes(remaining)} left (done around ${eta})`
                      : " · taking longer than usual, finishing up"
                    : ""
                }`
              : run?.finishedAt
                ? `${new Date(run.finishedAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Sarajevo" })} · took ${minutes(status?.elapsedSeconds ?? 0)}${typical ? ` · usually ${minutes(typical)}` : ""}`
                : "Collect from all sources, then screen new jobs."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {run && (
            <a href={run.url} target="_blank" rel="noopener noreferrer" className="btn-ghost text-xs">
              View on GitHub ↗
            </a>
          )}
          <button
            type="button"
            className="btn"
            disabled={pending || active || !status}
            onClick={() =>
              start(async () => {
                setError("");
                const before = status?.run?.id ?? 0;
                const r = await startRun();
                if (!r.ok) return setError(r.error);
                setWaitingForNewRun(before);
              })
            }
          >
            {active ? "Running…" : "Run now"}
          </button>
        </div>
      </div>

      {progress != null && (
        <div className="mt-3 h-2 rounded bg-zinc-100 dark:bg-zinc-800">
          <div className="h-2 rounded bg-sky-500 transition-all duration-1000" style={{ width: `${Math.round(progress * 100)}%` }} />
        </div>
      )}

      {status?.steps.length ? (
        <ol className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs">
          {status.steps.map((s) => (
            <li
              key={s.name}
              className={
                s.state === "done"
                  ? "text-emerald-700 dark:text-emerald-400"
                  : s.state === "running"
                    ? "font-medium text-sky-700 dark:text-sky-400"
                    : s.state === "failed"
                      ? "text-rose-600"
                      : "text-zinc-400"
              }
            >
              <span className={s.state === "running" ? "animate-pulse" : ""}>{STEP_ICON[s.state]}</span> {s.name}
            </li>
          ))}
        </ol>
      ) : null}
      {error && <p className="mt-2 text-xs text-rose-600">{error}</p>}
    </section>
  );
}
