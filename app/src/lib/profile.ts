/** Profile shape, defaults and parsing. Defaults mirror config/rules.yaml; salary has none on purpose. */

export const SENIORITY_LEVELS = {
  intern: "Intern / trainee",
  junior: "Junior",
  associate: "Associate",
  staff: "Staff",
  principal: "Principal",
  director: "Director",
  head: "Head of",
  vp: "VP / Chief",
} as const;

export const LOCATION_OPTIONS = {
  balkans: { label: "Names Bosnia, Serbia or Croatia", group: "core" },
  europe: { label: "Europe / EMEA", group: "core" },
  cet: { label: "CET time zone (UTC+1/+2)", group: "core" },
  worldwide: { label: "Worldwide / anywhere", group: "core" },
  slovenia: { label: "Slovenia", group: "extra" },
  montenegro: { label: "Montenegro", group: "extra" },
  north_macedonia: { label: "North Macedonia", group: "extra" },
  balkans_region: { label: '"Balkans" as a region', group: "extra" },
  cee: { label: "CEE / Central and Eastern Europe", group: "extra" },
  plain_remote: { label: 'Plain "Remote" with no region (unclear)', group: "extra" },
} as const;

export type Preferences = {
  categories: string[];
  primary_category: string;
  exclude_seniority: string[];
  work: { remote: boolean; sarajevo_hybrid: boolean; contract: boolean; employment: boolean };
  locations: Record<keyof typeof LOCATION_OPTIONS, boolean>;
  salary: {
    floor_eur_hour: number | null;
    target_eur_hour: number | null;
    employment_discount_pct: number | null;
    hours_per_month: number;
  };
  skip_companies: string[];
  ai: { allow_cv: boolean };
};

export type Facts = {
  location: string;
  notice_period: string;
  available_from: string;
  work_authorization: string;
  needs_sponsorship: "" | "no" | "yes";
  languages: string;
  linkedin: string;
  portfolio: string;
  github: string;
  other_links: string;
};

export const DEFAULT_PREFERENCES: Preferences = {
  categories: ["product_manager", "product_owner", "business_analyst", "project_manager", "implementation"],
  primary_category: "product_manager",
  exclude_seniority: ["intern", "junior", "associate", "staff", "principal", "director", "head", "vp"],
  work: { remote: true, sarajevo_hybrid: true, contract: true, employment: true },
  locations: {
    balkans: true,
    europe: true,
    cet: true,
    worldwide: true,
    slovenia: false,
    montenegro: false,
    north_macedonia: false,
    balkans_region: false,
    cee: false,
    plain_remote: false,
  },
  salary: { floor_eur_hour: null, target_eur_hour: null, employment_discount_pct: null, hours_per_month: 160 },
  skip_companies: [],
  // Drafting may send the current CV to Gemini (free tier), with name, email, phone and
  // profile links removed first. The owner chose this; it can be switched off on the Profile page.
  ai: { allow_cv: true },
};

export const EMPTY_FACTS: Facts = {
  location: "",
  notice_period: "",
  available_from: "",
  work_authorization: "",
  needs_sponsorship: "",
  languages: "",
  linkedin: "",
  portfolio: "",
  github: "",
  other_links: "",
};

export type Profile = {
  preferences: Preferences;
  weekly_goal: number | null;
  facts: Facts;
  experience: string;
  writing_rules: string;
  current_cv: string | null;
  updated_at: string | null;
};

/** Merge a stored profile over the defaults, so new fields always have a value. */
export function withDefaults(row: Partial<Record<string, unknown>> | null): Profile {
  const p = (row?.preferences ?? {}) as Partial<Preferences>;
  return {
    preferences: {
      ...DEFAULT_PREFERENCES,
      ...p,
      work: { ...DEFAULT_PREFERENCES.work, ...(p.work ?? {}) },
      locations: { ...DEFAULT_PREFERENCES.locations, ...(p.locations ?? {}) },
      salary: { ...DEFAULT_PREFERENCES.salary, ...(p.salary ?? {}) },
      ai: { ...DEFAULT_PREFERENCES.ai, ...(p.ai ?? {}) },
    },
    weekly_goal: (row?.weekly_goal as number | null) ?? null,
    facts: { ...EMPTY_FACTS, ...((row?.facts ?? {}) as Partial<Facts>) },
    experience: (row?.experience as string) ?? "",
    writing_rules: (row?.writing_rules as string) ?? "",
    current_cv: (row?.current_cv as string | null) ?? null,
    updated_at: (row?.updated_at as string | null) ?? null,
  };
}

/** Monthly floor in EUR (hourly floor x hours per month), or null if not set. */
export function monthlyFloor(prefs: Preferences): number | null {
  const h = prefs.salary.floor_eur_hour;
  return h ? Math.round(h * (prefs.salary.hours_per_month || 160)) : null;
}

export function num(value: FormDataEntryValue | null, min: number, max: number): number | null {
  if (value == null || String(value).trim() === "") return null;
  const n = Number(String(value).replace(",", "."));
  if (!Number.isFinite(n)) return null;
  return Math.min(max, Math.max(min, Math.round(n * 100) / 100));
}

export function text(value: FormDataEntryValue | null, max = 500): string {
  return String(value ?? "").trim().slice(0, max);
}
