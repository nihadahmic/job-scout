"use server";

import { revalidatePath } from "next/cache";
import {
  DEFAULT_PREFERENCES,
  LOCATION_OPTIONS,
  SENIORITY_LEVELS,
  num,
  text,
  withDefaults,
  type Facts,
  type Preferences,
} from "@/lib/profile";
import { CATEGORY_LABELS } from "@/lib/labels";
import { createClient } from "@/lib/supabase/server";

export type SaveResult = { ok: true; at: string } | { ok: false; error: string };

async function save(patch: Record<string, unknown>): Promise<SaveResult> {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, error: "Signed out" };
  const { error } = await supabase
    .from("profile")
    .upsert({ user_id: auth.user.id, ...patch }, { onConflict: "user_id" });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/profile");
  revalidatePath("/");
  revalidatePath("/insights");
  return { ok: true, at: new Date().toISOString() };
}

async function current() {
  const supabase = await createClient();
  const { data } = await supabase.from("profile").select("*").maybeSingle();
  return withDefaults(data);
}

export async function savePreferences(_: SaveResult | null, form: FormData): Promise<SaveResult> {
  const prev = (await current()).preferences;
  const pick = (name: string, allowed: Record<string, unknown>) =>
    form.getAll(name).map(String).filter((v) => v in allowed);
  const categories = pick("categories", CATEGORY_LABELS);
  if (!categories.length) return { ok: false, error: "Pick at least one category" };
  const primary = text(form.get("primary_category"), 40);
  const locations = Object.fromEntries(
    Object.keys(LOCATION_OPTIONS).map((k) => [k, form.getAll("locations").includes(k)]),
  ) as Preferences["locations"];
  const prefs: Preferences = {
    ...DEFAULT_PREFERENCES,
    ...prev,
    categories,
    primary_category: categories.includes(primary) ? primary : categories[0],
    exclude_seniority: pick("exclude_seniority", SENIORITY_LEVELS),
    work: {
      remote: form.get("work_remote") === "on",
      sarajevo_hybrid: form.get("work_sarajevo_hybrid") === "on",
      contract: form.get("work_contract") === "on",
      employment: form.get("work_employment") === "on",
    },
    locations,
    salary: {
      floor_eur_hour: num(form.get("floor_eur_hour"), 0, 1000),
      target_eur_hour: num(form.get("target_eur_hour"), 0, 1000),
      employment_discount_pct: num(form.get("employment_discount_pct"), 0, 90),
      hours_per_month: num(form.get("hours_per_month"), 1, 300) ?? 160,
    },
    skip_companies: String(form.get("skip_companies") ?? "")
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 500),
  };
  return save({ preferences: prefs, weekly_goal: num(form.get("weekly_goal"), 0, 100) });
}

export async function saveFacts(_: SaveResult | null, form: FormData): Promise<SaveResult> {
  const sponsorship = text(form.get("needs_sponsorship"), 3);
  const facts: Facts = {
    full_name: text(form.get("full_name"), 120),
    location: text(form.get("location"), 120),
    notice_period: text(form.get("notice_period"), 120),
    available_from: text(form.get("available_from"), 40),
    work_authorization: text(form.get("work_authorization"), 300),
    needs_sponsorship: sponsorship === "yes" || sponsorship === "no" ? sponsorship : "",
    languages: text(form.get("languages"), 200),
    linkedin: text(form.get("linkedin"), 300),
    portfolio: text(form.get("portfolio"), 300),
    github: text(form.get("github"), 300),
    other_links: text(form.get("other_links"), 1000),
  };
  return save({ facts });
}

export async function saveWriting(_: SaveResult | null, form: FormData): Promise<SaveResult> {
  const prefs = (await current()).preferences;
  return save({
    experience: text(form.get("experience"), 20_000),
    writing_rules: text(form.get("writing_rules"), 10_000),
    preferences: { ...prefs, ai: { ...prefs.ai, allow_cv: form.get("allow_cv") === "on" } },
  });
}

export async function setCurrentCv(path: string | null): Promise<SaveResult> {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (path && (!auth.user || !path.startsWith(`${auth.user.id}/`))) return { ok: false, error: "Not your file" };
  return save({ current_cv: path });
}
