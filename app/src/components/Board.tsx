"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { changeStatus } from "@/app/actions";
import {
  CATEGORY_LABELS,
  CATEGORY_STYLES,
  CLOSE_REASONS,
  DEFAULT_CATEGORY_STYLE,
  closeReasonTone,
  type Status,
} from "@/lib/labels";

export type BoardJob = {
  id: string;
  company: string;
  title: string;
  category: string | null;
  status: Status;
  close_reason: string | null;
  since: string; // when it entered its current status (ISO)
  waitingDays: number | null; // applied with no reply for this long
};

type ColumnKey = "in_progress" | "applied" | "interviewing" | "offer" | "closed";

const COLUMNS: { key: ColumnKey; title: string; status: Status | null; hint: string }[] = [
  { key: "in_progress", title: "In progress", status: "in_progress", hint: "Preparing an application" },
  { key: "applied", title: "Applied", status: "applied", hint: "Waiting to hear back" },
  { key: "interviewing", title: "Interviewing", status: "interviewing", hint: "Any reply that moves forward" },
  { key: "offer", title: "Offer", status: "offer", hint: "Offers, and offers you accepted" },
  { key: "closed", title: "Closed", status: null, hint: "Drop here, then pick a reason" },
];

function columnOf(status: Status): ColumnKey {
  if (status === "offer" || status === "accepted") return "offer";
  if (status === "in_progress" || status === "applied" || status === "interviewing") return status;
  return "closed";
}

function since(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days`;
}

export function Board({ jobs: initial, followUpDays }: { jobs: BoardJob[]; followUpDays: number }) {
  const router = useRouter();
  const [jobs, setJobs] = useState(initial);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<ColumnKey | null>(null);
  const [closing, setClosing] = useState<BoardJob | null>(null);
  const [error, setError] = useState("");
  const [, startTransition] = useTransition();

  // After a save, the server sends fresh props; take them as the new truth.
  useEffect(() => setJobs(initial), [initial]);

  const byColumn = useMemo(() => {
    const m: Record<ColumnKey, BoardJob[]> = { in_progress: [], applied: [], interviewing: [], offer: [], closed: [] };
    for (const j of jobs) m[columnOf(j.status)].push(j);
    return m;
  }, [jobs]);

  function move(job: BoardJob, status: Status, reason?: string, note?: string) {
    if (status === job.status && !reason) return;
    const before = jobs;
    const now = new Date().toISOString();
    setJobs((js) =>
      js.map((j) =>
        j.id === job.id
          ? { ...j, status, close_reason: reason ?? (columnOf(status) === "closed" ? j.close_reason : null), since: now, waitingDays: null }
          : j,
      ),
    );
    setError("");
    startTransition(async () => {
      const result = await changeStatus(job.id, status, note, undefined, reason);
      if (!result.ok) {
        setJobs(before);
        setError(`Couldn't move ${job.company}: ${result.error}`);
      } else {
        router.refresh();
      }
    });
  }

  function dropInto(key: ColumnKey, jobId: string) {
    const job = jobs.find((j) => j.id === jobId);
    if (!job || columnOf(job.status) === key) return;
    if (key === "closed") setClosing(job);
    else move(job, COLUMNS.find((c) => c.key === key)!.status!);
  }

  return (
    <>
      {error && (
        <p className="mb-3 rounded-md bg-rose-50 p-3 text-sm text-rose-800 dark:bg-rose-950 dark:text-rose-200">{error}</p>
      )}
      <div className="grid gap-3 md:grid-cols-5">
        {COLUMNS.map((col) => (
          <section
            key={col.key}
            onDragOver={(e) => {
              e.preventDefault();
              setOver(col.key);
            }}
            onDragLeave={() => setOver((o) => (o === col.key ? null : o))}
            onDrop={(e) => {
              e.preventDefault();
              setOver(null);
              dropInto(col.key, e.dataTransfer.getData("text/plain"));
            }}
            className={`flex min-h-40 flex-col rounded-lg p-2 transition-colors ${
              over === col.key && dragging
                ? "bg-sky-50 ring-2 ring-sky-300 dark:bg-sky-950 dark:ring-sky-800"
                : "bg-zinc-100 dark:bg-zinc-900"
            }`}
          >
            <header className="mb-2 flex items-baseline justify-between px-1">
              <h2 className="text-sm font-medium">{col.title}</h2>
              <span className="text-xs tabular-nums text-zinc-500">{byColumn[col.key].length}</span>
            </header>
            <div className="flex flex-col gap-2">
              {byColumn[col.key].map((job) => (
                <Card
                  key={job.id}
                  job={job}
                  followUpDays={followUpDays}
                  onDragStart={() => setDragging(job.id)}
                  onDragEnd={() => setDragging(null)}
                  onMove={(key) => (key === "closed" ? setClosing(job) : dropInto(key, job.id))}
                />
              ))}
              {byColumn[col.key].length === 0 && (
                <p className="rounded-md border border-dashed border-zinc-300 px-2 py-6 text-center text-xs text-zinc-500 dark:border-zinc-700">
                  {col.hint}
                </p>
              )}
            </div>
          </section>
        ))}
      </div>
      {closing && (
        <CloseDialog
          job={closing}
          onCancel={() => setClosing(null)}
          onConfirm={(reason, note) => {
            const status = CLOSE_REASONS.find((r) => r.label === reason)!.status;
            move(closing, status, reason, note);
            setClosing(null);
          }}
        />
      )}
    </>
  );
}

function Card({
  job,
  followUpDays,
  onDragStart,
  onDragEnd,
  onMove,
}: {
  job: BoardJob;
  followUpDays: number;
  onDragStart: () => void;
  onDragEnd: () => void;
  onMove: (key: ColumnKey) => void;
}) {
  const style = CATEGORY_STYLES[job.category ?? ""] ?? DEFAULT_CATEGORY_STYLE;
  const col = columnOf(job.status);
  const stale = job.waitingDays != null && job.waitingDays >= followUpDays;
  const tone = col === "closed" ? closeReasonTone(job.close_reason, job.status) : null;
  return (
    <article
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", job.id);
        e.dataTransfer.effectAllowed = "move";
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      className={`cursor-grab rounded-md border border-l-4 bg-white p-2 text-xs shadow-sm active:cursor-grabbing dark:bg-zinc-950 ${style.edge} ${
        stale ? "border-amber-300 dark:border-amber-700" : "border-zinc-200 dark:border-zinc-800"
      } ${col === "closed" ? "opacity-80" : ""}`}
    >
      <Link href={`/job?id=${encodeURIComponent(job.id)}`} className="block hover:underline">
        <span className="block text-sm font-medium">{job.company}</span>
        <span className="block truncate text-zinc-600 dark:text-zinc-400">{job.title}</span>
      </Link>
      <div className="mt-1.5 flex flex-wrap items-center gap-1">
        {job.status === "accepted" && (
          <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[11px] text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">Accepted</span>
        )}
        {col === "closed" && (
          <span
            className={`rounded-full px-1.5 py-0.5 text-[11px] ${
              tone === "company"
                ? "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300"
                : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
            }`}
          >
            {job.close_reason ?? "No reason recorded"}
          </span>
        )}
        {stale ? (
          <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[11px] text-amber-800 dark:bg-amber-950 dark:text-amber-300">
            {job.waitingDays} days, no reply
          </span>
        ) : (
          col !== "closed" && <span className="text-[11px] text-zinc-500">{since(job.since)}</span>
        )}
        {job.category && col !== "closed" && (
          <span className={`rounded-full px-1.5 py-0.5 text-[11px] ${style.tag}`}>{CATEGORY_LABELS[job.category]}</span>
        )}
      </div>
      <select
        aria-label={`Move ${job.company}`}
        value=""
        onChange={(e) => e.target.value && onMove(e.target.value as ColumnKey)}
        className="mt-1.5 w-full rounded border border-zinc-200 bg-transparent px-1 py-0.5 text-[11px] text-zinc-500 dark:border-zinc-800"
      >
        <option value="">Move to…</option>
        {COLUMNS.filter((c) => c.key !== col || c.key === "closed").map((c) => (
          <option key={c.key} value={c.key}>
            {c.key === col ? "Change reason…" : c.title}
          </option>
        ))}
      </select>
    </article>
  );
}

function CloseDialog({
  job,
  onCancel,
  onConfirm,
}: {
  job: BoardJob;
  onCancel: () => void;
  onConfirm: (reason: string, note: string) => void;
}) {
  const [reason, setReason] = useState<string>(job.close_reason ?? "");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Close ${job.company}`}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onCancel}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          if (!reason) {
            setError("Pick a reason first");
            return;
          }
          onConfirm(reason, note);
        }}
        className="w-full max-w-md rounded-xl bg-white p-5 shadow-lg dark:bg-zinc-900"
      >
        <h2 className="font-medium">
          Close {job.company}, {job.title}
        </h2>
        <p className="mb-3 text-sm text-zinc-500">Why is it closed?</p>
        <div className="flex flex-wrap gap-2">
          {CLOSE_REASONS.map((r) => (
            <button
              type="button"
              key={r.label}
              onClick={() => {
                setReason(r.label);
                setError("");
              }}
              className={`rounded-full border px-3 py-1 text-sm ${
                reason === r.label
                  ? r.by === "company"
                    ? "border-rose-300 bg-rose-100 text-rose-800 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-300"
                    : "border-zinc-400 bg-zinc-200 text-zinc-900 dark:border-zinc-500 dark:bg-zinc-700 dark:text-zinc-100"
                  : "border-zinc-300 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
        {error && <p className="mt-2 text-sm text-rose-600">{error}</p>}
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Add detail (optional)"
          className="field mt-3 w-full"
        />
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="btn-ghost">
            Cancel
          </button>
          <button className="btn">Close job</button>
        </div>
      </form>
    </div>
  );
}
