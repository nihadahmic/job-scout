"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { isStatus } from "@/lib/labels";
import { createClient } from "@/lib/supabase/server";

export type ActionResult = { ok: true } | { ok: false; error: string };

/** Changes status through change_status(), which also writes the history row. */
export async function changeStatus(
  jobId: string,
  status: string,
  note?: string,
  day?: string,
): Promise<ActionResult> {
  if (!isStatus(status)) return { ok: false, error: "Unknown status" };
  if (day && !/^\d{4}-\d{2}-\d{2}$/.test(day)) return { ok: false, error: "Invalid date" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("change_status", {
    p_job_id: jobId,
    p_status: status,
    p_note: note ?? null,
    // Noon in Sarajevo, so the day is right in either winter or summer time.
    p_changed_at: day ? `${day}T12:00:00+01:00` : null,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/");
  revalidatePath("/job");
  revalidatePath("/insights");
  return { ok: true };
}

export async function saveNotes(jobId: string, notes: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("jobs").update({ notes }).eq("id", jobId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/job");
  return { ok: true };
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
