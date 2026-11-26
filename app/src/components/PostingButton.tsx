"use client";

import { useEffect, useState } from "react";
import { postingState } from "@/app/job/posting-actions";
import type { PostingState } from "@/lib/posting-check";

/** "Open posting", checked in the background; turns into "Posting removed" when it's gone. */
export function PostingButton({ jobId, url }: { jobId: string; url: string }) {
  const [check, setCheck] = useState<PostingState | null>(null);
  useEffect(() => {
    let cancelled = false;
    postingState(jobId)
      .then((r) => !cancelled && setCheck(r))
      .catch(() => !cancelled && setCheck({ state: "unknown", how: "check failed" }));
    return () => {
      cancelled = true;
    };
  }, [jobId]);

  const removed = check?.state === "removed";
  return (
    <span className="flex flex-col items-end gap-1">
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className={
          removed
            ? "rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-500 line-through decoration-zinc-400 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
            : "btn"
        }
        title={check ? `Checked: ${check.how}` : "Checking whether the posting is still up…"}
      >
        {removed ? "Posting removed" : "Open posting ↗"}
      </a>
      {removed && (
        <span className="max-w-56 text-right text-[11px] text-zinc-500">
          Taken down ({check?.how}). The details saved here stay available.
        </span>
      )}
      {!check && <span className="text-[11px] text-zinc-400">Checking posting…</span>}
    </span>
  );
}
