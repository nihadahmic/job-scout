"use client";

import { useState, useTransition } from "react";
import { addNote, deleteNote, editNote, type JobNote } from "@/app/job/note-actions";

export function noteTime(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: new Date(iso).getFullYear() === new Date().getFullYear() ? undefined : "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Sarajevo",
  });
}

export function NotesThread({ jobId, notes: initial }: { jobId: string; notes: JobNote[] }) {
  const [notes, setNotes] = useState(initial);
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<number | null>(null);
  const [editText, setEditText] = useState("");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();

  const act = (fn: () => Promise<void>) => {
    setError("");
    start(fn);
  };

  return (
    <div className="flex flex-col gap-3">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          act(async () => {
            const r = await addNote(jobId, draft);
            if (r.ok) {
              setNotes((ns) => [r.note, ...ns]);
              setDraft("");
            } else setError(r.error);
          });
        }}
      >
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) e.currentTarget.form?.requestSubmit();
          }}
          rows={3}
          placeholder="Add a note: who you spoke to, next steps…"
          className="field w-full text-sm"
        />
        <div className="mt-1 flex items-center justify-between">
          <span className="text-[11px] text-zinc-400">Cmd+Enter to add</span>
          <button className="btn text-xs" disabled={pending || !draft.trim()}>
            Add note
          </button>
        </div>
      </form>
      {error && <p className="text-xs text-rose-600">{error}</p>}

      <ol className="flex flex-col gap-2">
        {notes.map((n) => (
          <li key={n.id} className="rounded-lg bg-zinc-50 p-2.5 text-sm dark:bg-zinc-900">
            <div className="mb-1 flex items-center gap-2 text-[11px] text-zinc-500">
              <span title={n.legacy ? "Carried over from your earlier notes; the exact date wasn't recorded" : undefined}>
                {n.legacy ? "Earlier note · " : ""}
                {noteTime(n.created_at)}
              </span>
              {n.edited_at && <span>· edited {noteTime(n.edited_at)}</span>}
              {editing !== n.id && (
                <span className="ml-auto flex gap-2">
                  <button
                    type="button"
                    className="hover:text-zinc-900 dark:hover:text-zinc-100"
                    onClick={() => {
                      setEditing(n.id);
                      setEditText(n.body);
                    }}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="hover:text-rose-600"
                    onClick={() => {
                      if (!window.confirm("Delete this note?")) return;
                      act(async () => {
                        const r = await deleteNote(n.id);
                        if (r.ok) setNotes((ns) => ns.filter((x) => x.id !== n.id));
                        else setError(r.error);
                      });
                    }}
                  >
                    Delete
                  </button>
                </span>
              )}
            </div>
            {editing === n.id ? (
              <div>
                <textarea value={editText} onChange={(e) => setEditText(e.target.value)} rows={3} className="field w-full text-sm" />
                <div className="mt-1 flex justify-end gap-2">
                  <button type="button" className="btn-ghost text-xs" onClick={() => setEditing(null)}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="btn text-xs"
                    disabled={pending || !editText.trim() || editText.trim() === n.body}
                    onClick={() =>
                      act(async () => {
                        const r = await editNote(n.id, editText);
                        if (r.ok) {
                          setNotes((ns) => ns.map((x) => (x.id === n.id ? r.note : x)));
                          setEditing(null);
                        } else setError(r.error);
                      })
                    }
                  >
                    Save
                  </button>
                </div>
              </div>
            ) : (
              <p className="whitespace-pre-wrap break-words">{n.body}</p>
            )}
          </li>
        ))}
        {!notes.length && <li className="text-xs text-zinc-500">No notes yet.</li>}
      </ol>
    </div>
  );
}
