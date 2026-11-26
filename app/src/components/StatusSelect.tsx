"use client";

import { useState, useTransition } from "react";
import { changeStatus } from "@/app/actions";
import { ACTIVE_STATUSES, CLOSED_STATUSES, STATUS_COLORS, STATUS_LABELS, type Status } from "@/lib/labels";

export function StatusOptions() {
  return (
    <>
      <optgroup label="Active">
        {ACTIVE_STATUSES.map((s) => (
          <option key={s} value={s}>
            {STATUS_LABELS[s]}
          </option>
        ))}
      </optgroup>
      <optgroup label="Closed">
        {CLOSED_STATUSES.map((s) => (
          <option key={s} value={s}>
            {STATUS_LABELS[s]}
          </option>
        ))}
      </optgroup>
    </>
  );
}

/** Compact status changer for the list. Use the job page to add a note with the change. */
export function StatusSelect({ jobId, status }: { jobId: string; status: Status }) {
  const [value, setValue] = useState<Status>(status);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");

  return (
    <div>
      <select
        aria-label="Status"
        value={value}
        disabled={pending}
        className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[value]} disabled:opacity-50`}
        onChange={(e) => {
          const next = e.target.value as Status;
          const previous = value;
          setValue(next);
          setError("");
          startTransition(async () => {
            const result = await changeStatus(jobId, next);
            if (!result.ok) {
              setValue(previous);
              setError(result.error);
            }
          });
        }}
      >
        <StatusOptions />
      </select>
      {error && <p className="mt-1 text-xs text-rose-600">{error}</p>}
    </div>
  );
}
