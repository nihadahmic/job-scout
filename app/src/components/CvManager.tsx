"use client";

import { useEffect, useState, useTransition } from "react";
import { setCurrentCv } from "@/app/profile/actions";
import { createClient } from "@/lib/supabase/browser";

type FileRow = { name: string; path: string; size: number; created: string };

const BUCKET = "cv";
const MAX_BYTES = 10 * 1024 * 1024;

export function CvManager({ userId, current: initialCurrent }: { userId: string; current: string | null }) {
  const [files, setFiles] = useState<FileRow[]>([]);
  const [current, setCurrent] = useState(initialCurrent);
  const [message, setMessage] = useState("");
  const [busy, startTransition] = useTransition();

  async function refresh() {
    const supabase = createClient();
    const { data, error } = await supabase.storage.from(BUCKET).list(userId, { sortBy: { column: "created_at", order: "desc" } });
    if (error) return setMessage(error.message);
    setFiles(
      (data ?? [])
        .filter((f) => f.name.toLowerCase().endsWith(".pdf"))
        .map((f) => ({
          name: f.name.replace(/^\d+-/, ""),
          path: `${userId}/${f.name}`,
          size: (f.metadata as { size?: number } | null)?.size ?? 0,
          created: f.created_at ?? "",
        })),
    );
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function upload(file: File) {
    setMessage("");
    if (file.type !== "application/pdf") return setMessage("Upload a PDF.");
    if (file.size > MAX_BYTES) return setMessage("That file is over 10 MB.");
    startTransition(async () => {
      const supabase = createClient();
      const safe = file.name.replace(/[^\w.-]+/g, "_").slice(-80);
      const path = `${userId}/${Date.now()}-${safe}`;
      const { error } = await supabase.storage.from(BUCKET).upload(path, file, { contentType: "application/pdf" });
      if (error) return setMessage(error.message);
      const result = await setCurrentCv(path);
      if (!result.ok) return setMessage(result.error);
      setCurrent(path);
      setMessage("Uploaded and marked current.");
      await refresh();
    });
  }

  function open(path: string) {
    startTransition(async () => {
      const { data, error } = await createClient().storage.from(BUCKET).createSignedUrl(path, 60);
      if (error || !data) return setMessage(error?.message ?? "Couldn't open the file.");
      window.open(data.signedUrl, "_blank", "noopener,noreferrer");
    });
  }

  function makeCurrent(path: string) {
    startTransition(async () => {
      const result = await setCurrentCv(path);
      if (result.ok) setCurrent(path);
      else setMessage(result.error);
    });
  }

  function remove(path: string) {
    if (!window.confirm("Delete this CV? This can't be undone.")) return;
    startTransition(async () => {
      const { error } = await createClient().storage.from(BUCKET).remove([path]);
      if (error) return setMessage(error.message);
      if (current === path) {
        await setCurrentCv(null);
        setCurrent(null);
      }
      await refresh();
    });
  }

  return (
    <fieldset className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <legend className="px-1 text-sm font-medium">CV</legend>
      <p className="mb-3 text-xs text-zinc-500">
        Stored privately in your Supabase project; only your account can open it. Whether drafting may send it to
        Gemini (with contact details removed) is set under Experience and writing.
      </p>
      <label className="btn inline-block cursor-pointer">
        {busy ? "Working…" : "Upload PDF"}
        <input
          type="file"
          accept="application/pdf"
          className="sr-only"
          disabled={busy}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) upload(f);
            e.target.value = "";
          }}
        />
      </label>
      {message && <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">{message}</p>}
      <ul className="mt-3 divide-y divide-zinc-100 text-sm dark:divide-zinc-800">
        {files.map((f) => (
          <li key={f.path} className="flex flex-wrap items-center gap-3 py-2">
            <button type="button" onClick={() => open(f.path)} className="font-medium hover:underline">
              {f.name}
            </button>
            <span className="text-xs text-zinc-500">
              {f.size ? `${Math.round(f.size / 1024)} KB · ` : ""}
              {f.created ? new Date(f.created).toLocaleDateString("en-GB") : ""}
            </span>
            {current === f.path ? (
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">Current</span>
            ) : (
              <button type="button" onClick={() => makeCurrent(f.path)} className="text-xs text-zinc-500 hover:underline">
                Make current
              </button>
            )}
            <button type="button" onClick={() => remove(f.path)} className="ml-auto text-xs text-rose-600 hover:underline">
              Delete
            </button>
          </li>
        ))}
        {!files.length && <li className="py-2 text-xs text-zinc-500">No CV uploaded yet.</li>}
      </ul>
    </fieldset>
  );
}
