"use server";

import { checkPosting, type PostingState } from "@/lib/posting-check";
import { createClient } from "@/lib/supabase/server";

/** Check whether a stored job's posting is still up. Reads the job as the signed-in owner. */
export async function postingState(jobId: string): Promise<PostingState> {
  const supabase = await createClient();
  const { data: job } = await supabase
    .from("jobs")
    .select("source, source_id, url, apply_url")
    .eq("id", jobId)
    .maybeSingle();
  if (!job) return { state: "unknown", how: "job not found" };
  return checkPosting(job);
}
