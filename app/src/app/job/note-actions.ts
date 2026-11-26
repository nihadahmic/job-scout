"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type JobNote = { id: number; created_at: string; edited_at: string | null; body: string; legacy: boolean };
type Result<T> = ({ ok: true } & T) | { ok: false; error: string };

const MAX = 5_000;
const COLUMNS = "id, created_at, edited_at, body, legacy";

export async function addNote(jobId: string, body: string): Promise<Result<{ note: JobNote }>> {
  const text = body.trim().slice(0, MAX);
  if (!text) return { ok: false, error: "Write something first." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("job_notes").insert({ job_id: jobId, body: text }).select(COLUMNS).single();
  if (error) return { ok: false, error: error.message };
  revalidatePath("/job");
  return { ok: true, note: data as JobNote };
}

export async function editNote(noteId: number, body: string): Promise<Result<{ note: JobNote }>> {
  const text = body.trim().slice(0, MAX);
  if (!text) return { ok: false, error: "A note can't be empty. Delete it instead." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("job_notes")
    .update({ body: text, edited_at: new Date().toISOString() })
    .eq("id", noteId)
    .select(COLUMNS)
    .single();
  if (error) return { ok: false, error: error.message };
  revalidatePath("/job");
  return { ok: true, note: data as JobNote };
}

export async function deleteNote(noteId: number): Promise<Result<object>> {
  const supabase = await createClient();
  const { error } = await supabase.from("job_notes").delete().eq("id", noteId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/job");
  return { ok: true };
}
