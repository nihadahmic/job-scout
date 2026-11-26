"use server";

import { revalidatePath } from "next/cache";
import { ATS_TYPES, type AtsType, type Detection, type FeedPreview, countJobs, detectCompany, previewFeed } from "@/lib/sources";
import { createClient } from "@/lib/supabase/server";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

async function owner() {
  const supabase = await createClient();
  const { data } = await supabase.rpc("is_owner");
  if (data !== true) throw new Error("Only the owner can change sources.");
  return supabase;
}

function normalizeUrl(input: string): string {
  const raw = input.trim();
  const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  if (!/^https?:$/.test(url.protocol)) throw new Error("Use an http or https address.");
  return url.toString();
}

async function run<T>(fn: () => Promise<T>): Promise<Result<{ value: T }>> {
  try {
    const value = await fn();
    revalidatePath("/sources");
    return { ok: true, value };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Something went wrong.";
    return { ok: false, error: /duplicate key/.test(message) ? "That one is already on your list." : message };
  }
}

// Companies --------------------------------------------------------------------

export async function detect(website: string, name: string): Promise<Result<{ value: Detection }>> {
  return run(async () => {
    await owner();
    return detectCompany(normalizeUrl(website), name);
  });
}

export async function checkBoard(ats: string, slug: string): Promise<Result<{ value: number | null }>> {
  return run(async () => {
    await owner();
    if (!ATS_TYPES.includes(ats as AtsType)) throw new Error("Unknown ATS.");
    return countJobs(ats as AtsType, slug.trim());
  });
}

export async function addCompany(input: {
  name: string;
  website: string;
  ats: string;
  slug: string | null;
  region: string | null;
  note: string;
}): Promise<Result<{ value: null }>> {
  return run(async () => {
    const supabase = await owner();
    const name = input.name.trim() || new URL(normalizeUrl(input.website)).hostname.replace(/^www\./, "");
    const ats = ATS_TYPES.includes(input.ats as AtsType) ? input.ats : "unknown";
    const { error } = await supabase.from("watchlist").insert({
      name: name.slice(0, 120),
      website: normalizeUrl(input.website),
      ats,
      slug: ats === "unknown" ? null : input.slug?.trim() || null,
      ats_region: input.region,
      ats_note: input.note.slice(0, 300),
      ats_locked: true, // chosen by hand on the Sources page
      detected_at: new Date().toISOString(),
    });
    if (error) throw new Error(error.message);
    return null;
  });
}

export async function updateCompany(id: number, patch: { paused?: boolean; ats?: string; slug?: string | null }) {
  return run(async () => {
    const supabase = await owner();
    const clean: Record<string, unknown> = {};
    if (typeof patch.paused === "boolean") clean.paused = patch.paused;
    if (patch.ats && (ATS_TYPES.includes(patch.ats as AtsType) || patch.ats === "unknown")) {
      clean.ats = patch.ats;
      clean.slug = patch.ats === "unknown" ? null : patch.slug?.trim() || null;
      clean.ats_locked = true;
      clean.ats_note = "set by hand";
    }
    const { error } = await supabase.from("watchlist").update(clean).eq("id", id);
    if (error) throw new Error(error.message);
    return null;
  });
}

export async function removeCompany(id: number) {
  return run(async () => {
    const supabase = await owner();
    const { error } = await supabase.from("watchlist").delete().eq("id", id);
    if (error) throw new Error(error.message);
    return null;
  });
}

// Feeds ------------------------------------------------------------------------

export async function checkFeed(url: string): Promise<Result<{ value: FeedPreview }>> {
  return run(async () => {
    await owner();
    return previewFeed(normalizeUrl(url));
  });
}

export async function addFeed(input: { name: string; url: string; allRemote: boolean }) {
  return run(async () => {
    const supabase = await owner();
    const url = normalizeUrl(input.url);
    const { error } = await supabase.from("feeds").insert({
      name: (input.name.trim() || new URL(url).hostname.replace(/^www\./, "")).slice(0, 120),
      url,
      all_remote: input.allRemote,
    });
    if (error) throw new Error(error.message);
    return null;
  });
}

export async function updateFeed(id: number, patch: { paused?: boolean; all_remote?: boolean }) {
  return run(async () => {
    const supabase = await owner();
    const { error } = await supabase.from("feeds").update(patch).eq("id", id);
    if (error) throw new Error(error.message);
    return null;
  });
}

export async function removeFeed(id: number) {
  return run(async () => {
    const supabase = await owner();
    const { error } = await supabase.from("feeds").delete().eq("id", id);
    if (error) throw new Error(error.message);
    return null;
  });
}

// Requests and switches ---------------------------------------------------------

export async function addRequest(input: { name: string; url: string; note: string }) {
  return run(async () => {
    const supabase = await owner();
    if (!input.name.trim()) throw new Error("Give it a name.");
    const { error } = await supabase.from("source_requests").insert({
      name: input.name.trim().slice(0, 120),
      url: input.url.trim().slice(0, 500) || null,
      note: input.note.trim().slice(0, 1000) || null,
    });
    if (error) throw new Error(error.message);
    return null;
  });
}

export async function updateRequest(id: number, status: "open" | "done" | "declined") {
  return run(async () => {
    const supabase = await owner();
    const { error } = await supabase
      .from("source_requests")
      .update({ status, resolved_at: status === "open" ? null : new Date().toISOString() })
      .eq("id", id);
    if (error) throw new Error(error.message);
    return null;
  });
}

export async function setSourceEnabled(source: string, enabled: boolean) {
  return run(async () => {
    const supabase = await owner();
    const { error } = await supabase
      .from("source_settings")
      .upsert({ source, enabled, updated_at: new Date().toISOString() }, { onConflict: "source" });
    if (error) throw new Error(error.message);
    return null;
  });
}
