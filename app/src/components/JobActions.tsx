"use client";

import { useState, useTransition } from "react";
import { changeStatus, saveNotes } from "@/app/actions";
import { StatusOptions } from "@/components/StatusSelect";
import type { Status } from "@/lib/labels";

export function StatusForm({ jobId, status }: { jobId: string; status: Status }) {
  const [next, setNext] = useState<Status>(status);
  const [note, setNote] = useState("");
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        setMessage("");
        startTransition(async () => {
          const result = await changeStatus(jobId, next, note);
          if (result.ok) {
            setNote("");
            setMessage("Saved");
          } else {
            setMessage(result.error);
          }
        });
      }}
    >
      <select
        aria-label="New status"
        value={next}
        onChange={(e) => setNext(e.target.value as Status)}
        className="field"
      >
        <StatusOptions />
      </select>
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Note for this change (optional)"
        className="field"
      />
      <div className="flex items-center gap-3">
        <button className="btn" disabled={pending || (next === status && !note.trim())}>
          {pending ? "Saving…" : "Update status"}
        </button>
        {message && <span className="text-xs text-zinc-500">{message}</span>}
      </div>
    </form>
  );
}

export function NotesForm({ jobId, notes }: { jobId: string; notes: string }) {
  const [value, setValue] = useState(notes);
  const [saved, setSaved] = useState(notes);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          const result = await saveNotes(jobId, value);
          if (result.ok) {
            setSaved(value);
            setMessage("Saved");
          } else {
            setMessage(result.error);
          }
        });
      }}
    >
      <textarea
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setMessage("");
        }}
        rows={6}
        placeholder="Contacts, next steps, anything worth remembering"
        className="field font-sans"
      />
      <div className="flex items-center gap-3">
        <button className="btn" disabled={pending || value === saved}>
          {pending ? "Saving…" : "Save notes"}
        </button>
        {message && <span className="text-xs text-zinc-500">{message}</span>}
      </div>
    </form>
  );
}
