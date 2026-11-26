"use client";

import { useActionState } from "react";
import { saveFacts, savePreferences, saveWriting, type SaveResult } from "@/app/profile/actions";
import { CATEGORY_LABELS, CATEGORY_STYLES, DEFAULT_CATEGORY_STYLE } from "@/lib/labels";
import { LOCATION_OPTIONS, SENIORITY_LEVELS, monthlyFloor, type Profile } from "@/lib/profile";

function Status({ state, pending }: { state: SaveResult | null; pending: boolean }) {
  if (pending) return <span className="text-xs text-zinc-500">Saving…</span>;
  if (!state) return null;
  return state.ok ? (
    <span className="text-xs text-emerald-700 dark:text-emerald-400">Saved</span>
  ) : (
    <span className="text-xs text-rose-600">{state.error}</span>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <fieldset className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <legend className="px-1 text-sm font-medium">{title}</legend>
      {hint && <p className="mb-3 text-xs text-zinc-500">{hint}</p>}
      {children}
    </fieldset>
  );
}

function Check({ name, value, checked, children }: { name: string; value?: string; checked: boolean; children: React.ReactNode }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" name={name} value={value} defaultChecked={checked} />
      {children}
    </label>
  );
}

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-xs text-zinc-500">{label}</span>
      {children}
      {hint && <span className="text-xs text-zinc-400">{hint}</span>}
    </label>
  );
}

export function PreferencesForm({ profile }: { profile: Profile }) {
  const [state, action, pending] = useActionState(savePreferences, null);
  const p = profile.preferences;
  const floor = monthlyFloor(p);
  return (
    <form action={action} className="flex flex-col gap-4">
      <Section title="Job categories" hint="Which roles the collector keeps. The primary one is what the cover letter leads with.">
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {Object.entries(CATEGORY_LABELS).map(([k, label]) => (
            <label key={k} className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="categories" value={k} defaultChecked={p.categories.includes(k)} />
              <span className={`rounded-full px-2 py-0.5 text-xs ${(CATEGORY_STYLES[k] ?? DEFAULT_CATEGORY_STYLE).tag}`}>{label}</span>
            </label>
          ))}
        </div>
        <div className="mt-3 max-w-xs">
          <Field label="Primary category">
            <select name="primary_category" defaultValue={p.primary_category} className="field">
              {Object.entries(CATEGORY_LABELS).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </Section>

      <Section title="Seniority to skip" hint="Titles with these words are dropped.">
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {Object.entries(SENIORITY_LEVELS).map(([k, label]) => (
            <Check key={k} name="exclude_seniority" value={k} checked={p.exclude_seniority.includes(k)}>
              {label}
            </Check>
          ))}
        </div>
      </Section>

      <Section title="Work type">
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          <Check name="work_remote" checked={p.work.remote}>Fully remote</Check>
          <Check name="work_sarajevo_hybrid" checked={p.work.sarajevo_hybrid}>Hybrid or on-site in Sarajevo</Check>
          <Check name="work_contract" checked={p.work.contract}>Contract / B2B</Check>
          <Check name="work_employment" checked={p.work.employment}>Employment</Check>
        </div>
      </Section>

      <Section title="Locations that count as eligible" hint='A remote job passes if its location matches one of these. The second group is off by default; plain "Remote" sends unclear jobs to screening later.'>
        <div className="grid gap-x-5 gap-y-2 sm:grid-cols-2">
          {Object.entries(LOCATION_OPTIONS).map(([k, o]) => (
            <Check key={k} name="locations" value={k} checked={p.locations[k as keyof typeof p.locations]}>
              <span className={o.group === "extra" ? "text-zinc-600 dark:text-zinc-400" : ""}>{o.label}</span>
            </Check>
          ))}
        </div>
      </Section>

      <Section title="Salary" hint="Used for the salary suggestion and to highlight jobs at or above your floor. Never sent to an AI model as a number to copy; the app does the arithmetic.">
        <div className="grid gap-3 sm:grid-cols-4">
          <Field label="Floor, EUR per hour (B2B)">
            <input name="floor_eur_hour" inputMode="decimal" defaultValue={p.salary.floor_eur_hour ?? ""} className="field" />
          </Field>
          <Field label="Target, EUR per hour (B2B)">
            <input name="target_eur_hour" inputMode="decimal" defaultValue={p.salary.target_eur_hour ?? ""} className="field" />
          </Field>
          <Field label="Employment is lower by, %">
            <input name="employment_discount_pct" inputMode="decimal" defaultValue={p.salary.employment_discount_pct ?? ""} className="field" />
          </Field>
          <Field label="Hours per month">
            <input name="hours_per_month" inputMode="numeric" defaultValue={p.salary.hours_per_month} className="field" />
          </Field>
        </div>
        {floor && <p className="mt-2 text-xs text-zinc-500">Monthly floor: about €{floor.toLocaleString("en-GB")}.</p>}
      </Section>

      <Section title="Weekly goal and companies to skip">
        <div className="grid gap-3 sm:grid-cols-[160px_1fr]">
          <Field label="Applications per week">
            <input name="weekly_goal" inputMode="numeric" defaultValue={profile.weekly_goal ?? ""} className="field" />
          </Field>
          <Field label="Companies to skip, one per line" hint="Jobs from these companies are dropped (already applied, not interested).">
            <textarea name="skip_companies" rows={4} defaultValue={p.skip_companies.join("\n")} className="field" />
          </Field>
        </div>
      </Section>

      <div className="flex items-center gap-3">
        <button className="btn" disabled={pending}>Save preferences</button>
        <Status state={state} pending={pending} />
      </div>
    </form>
  );
}

export function FactsForm({ profile }: { profile: Profile }) {
  const [state, action, pending] = useActionState(saveFacts, null);
  const f = profile.facts;
  return (
    <form action={action} className="flex flex-col gap-4">
      <Section title="Facts for application forms" hint="The app fills these into answers itself. They are never sent to an AI model.">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Full name" hint="Added to the cover letter sign-off, and used to remove your name from the CV text before Gemini sees it.">
            <input name="full_name" defaultValue={f.full_name} className="field" />
          </Field>
          <Field label="Where you're based"><input name="location" defaultValue={f.location} className="field" /></Field>
          <Field label="Languages"><input name="languages" defaultValue={f.languages} className="field" /></Field>
          <Field label="Notice period"><input name="notice_period" defaultValue={f.notice_period} className="field" /></Field>
          <Field label="Available from"><input name="available_from" defaultValue={f.available_from} className="field" /></Field>
          <Field label="Work authorization" hint="How you'd describe it on a form, in your words.">
            <input name="work_authorization" defaultValue={f.work_authorization} className="field" />
          </Field>
          <Field label="Needs visa sponsorship">
            <select name="needs_sponsorship" defaultValue={f.needs_sponsorship} className="field">
              <option value="">Not set</option>
              <option value="no">No</option>
              <option value="yes">Yes</option>
            </select>
          </Field>
          <Field label="LinkedIn URL"><input name="linkedin" defaultValue={f.linkedin} className="field" /></Field>
          <Field label="Portfolio URL"><input name="portfolio" defaultValue={f.portfolio} className="field" /></Field>
          <Field label="GitHub URL"><input name="github" defaultValue={f.github} className="field" /></Field>
          <Field label="Other links"><input name="other_links" defaultValue={f.other_links} className="field" /></Field>
        </div>
      </Section>
      <div className="flex items-center gap-3">
        <button className="btn" disabled={pending}>Save facts</button>
        <Status state={state} pending={pending} />
      </div>
    </form>
  );
}

export function WritingForm({ profile }: { profile: Profile }) {
  const [state, action, pending] = useActionState(saveWriting, null);
  return (
    <form action={action} className="flex flex-col gap-4">
      <Section
        title="Experience (anonymized)"
        hint="What drafting sends to Gemini's free tier. Keep out your name, contact details and employer names; describe companies instead (a B2B SaaS company, a digital health platform). Note owned vs contributed, and how a metric was measured."
      >
        <textarea name="experience" rows={14} defaultValue={profile.experience} className="field w-full font-mono text-xs leading-relaxed" />
      </Section>
      <Section title="What Gemini may read when drafting">
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="allow_cv" defaultChecked={profile.preferences.ai.allow_cv} className="mt-1" />
          <span>
            Let Gemini read my current CV when drafting.
            <span className="block text-xs text-zinc-500">
              Your name, email, phone number and profile links are removed before it is sent. Employer names and the
              rest go as written. Gemini&apos;s free tier may use what it receives to improve Google&apos;s products.
              Only the draft buttons send anything; collecting and screening never do.
            </span>
          </span>
        </label>
      </Section>
      <Section title="Writing rules" hint="Style rules for cover letters and answers. Drafts are checked against the ones the app can test (length, em dashes, banned phrases).">
        <textarea name="writing_rules" rows={10} defaultValue={profile.writing_rules} className="field w-full font-mono text-xs leading-relaxed" />
      </Section>
      <div className="flex items-center gap-3">
        <button className="btn" disabled={pending}>Save experience and rules</button>
        <Status state={state} pending={pending} />
      </div>
    </form>
  );
}
