"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { changeStatus } from "@/app/actions";

/** Start (In progress, so it shows in the Pipeline) or Skip, for a shortlisted job. */
export function QuickDecision({ jobId }: { jobId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  const act = (status: "in_progress" | "skipped") =>
    start(async () => {
      setError("");
      const r = await changeStatus(jobId, status);
      if (r.ok) router.refresh();
      else setError(r.error);
    });
  return (
    <span className="flex items-center gap-1">
      <button
        type="button"
        disabled={pending}
        onClick={() => act("in_progress")}
        className="rounded-md bg-sky-600 px-2 py-1 text-xs font-medium text-white hover:bg-sky-700 disabled:opacity-50"
      >
        Start
      </button>
      <button
        type="button"
        disabled={pending}
        onClick={() => act("skipped")}
        className="rounded-md border border-zinc-300 px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
      >
        Skip
      </button>
      {error && <span className="text-xs text-rose-600">{error}</span>}
    </span>
  );
}
