export const ACTIVE_STATUSES = [
  "new",
  "shortlisted",
  "in_progress",
  "applied",
  "interviewing",
  "offer",
] as const;
export const CLOSED_STATUSES = [
  "skipped",
  "withdrawn",
  "not_moving_forward",
  "accepted",
  "declined",
] as const;
export const STATUSES = [...ACTIVE_STATUSES, ...CLOSED_STATUSES];
export type Status = (typeof STATUSES)[number];

export const STATUS_LABELS: Record<Status, string> = {
  new: "New",
  shortlisted: "Shortlisted",
  in_progress: "In progress",
  applied: "Applied",
  interviewing: "Interviewing",
  offer: "Offer",
  skipped: "Skipped",
  withdrawn: "Withdrawn by me",
  not_moving_forward: "Not moving forward",
  accepted: "Accepted",
  declined: "Declined",
};

export const STATUS_COLORS: Record<Status, string> = {
  new: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  shortlisted: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300",
  in_progress: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  applied: "bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300",
  interviewing: "bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300",
  offer: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  skipped: "bg-zinc-100 text-zinc-500 dark:bg-zinc-900 dark:text-zinc-500",
  withdrawn: "bg-zinc-100 text-zinc-500 dark:bg-zinc-900 dark:text-zinc-500",
  not_moving_forward: "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300",
  accepted: "bg-emerald-200 text-emerald-900 dark:bg-emerald-900 dark:text-emerald-100",
  declined: "bg-zinc-100 text-zinc-500 dark:bg-zinc-900 dark:text-zinc-500",
};

export const CATEGORY_LABELS: Record<string, string> = {
  product_manager: "Product Manager",
  product_owner: "Product Owner",
  business_analyst: "Business Analyst",
  project_manager: "Project Manager",
  implementation: "Implementation",
};

export const LOCATION_MATCH_LABELS: Record<string, string> = {
  balkans: "Names BA/RS/HR",
  europe: "Europe / EMEA",
  cet: "CET time zone",
  worldwide: "Worldwide",
  description: "From description",
};

export const SOURCE_LABELS: Record<string, string> = {
  himalayas: "Himalayas",
  remotive: "Remotive",
  weworkremotely: "We Work Remotely",
  greenhouse: "Greenhouse",
  lever: "Lever",
  ashby: "Ashby",
  workable: "Workable",
  recruitee: "Recruitee",
  teamtailor: "Teamtailor",
  personio: "Personio",
  breezy: "Breezy",
  smartrecruiters: "SmartRecruiters",
  notion: "Notion (imported)",
};

export function isStatus(value: string): value is Status {
  return (STATUSES as readonly string[]).includes(value);
}

export function formatEur(value: number | null): string {
  if (value == null) return "";
  return `€${Math.round(value / 100) / 10}k`;
}

export function formatDate(value: string | null): string {
  if (!value) return "";
  return new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export function daysAgo(value: string | null): string {
  if (!value) return "";
  const days = Math.floor((Date.now() - new Date(value).getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
}

/** "24 Nov (2 days ago)"; the year is added when it isn't this year. */
export function dateWithAge(value: string | null): string {
  if (!value) return "";
  const d = new Date(value);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  const date = d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
    timeZone: "Europe/Sarajevo",
  });
  return `${date} (${daysAgo(value)})`;
}

/** Why a job left the pipeline. `status` is what change_status() records; `by` colours the tag. */
export const CLOSE_REASONS = [
  { label: "Rejected after applying", status: "not_moving_forward", by: "company" },
  { label: "Rejected after interview", status: "not_moving_forward", by: "company" },
  { label: "No response", status: "not_moving_forward", by: "company" },
  { label: "Role filled or closed", status: "not_moving_forward", by: "company" },
  { label: "Withdrew: not a fit", status: "withdrawn", by: "me" },
  { label: "Withdrew: salary", status: "withdrawn", by: "me" },
  { label: "Declined offer", status: "declined", by: "me" },
  { label: "Skipped (didn't apply)", status: "skipped", by: "me" },
] as const satisfies readonly { label: string; status: Status; by: "company" | "me" }[];

export function closeReasonTone(reason: string | null, status: Status): "company" | "me" {
  const known = CLOSE_REASONS.find((r) => r.label === reason);
  if (known) return known.by;
  return status === "not_moving_forward" ? "company" : "me";
}

/** One colour family per category, used for the row edge, initial and tag. */
export const CATEGORY_STYLES: Record<string, { edge: string; tag: string }> = {
  product_manager: {
    edge: "border-l-violet-500",
    tag: "bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300",
  },
  product_owner: {
    edge: "border-l-sky-500",
    tag: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300",
  },
  business_analyst: {
    edge: "border-l-fuchsia-500",
    tag: "bg-fuchsia-100 text-fuchsia-800 dark:bg-fuchsia-950 dark:text-fuchsia-300",
  },
  project_manager: {
    edge: "border-l-orange-500",
    tag: "bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-300",
  },
  implementation: {
    edge: "border-l-emerald-500",
    tag: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  },
};
export const DEFAULT_CATEGORY_STYLE = {
  edge: "border-l-zinc-300 dark:border-l-zinc-700",
  tag: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
};
export const LOCATION_TAG = "bg-teal-50 text-teal-800 dark:bg-teal-950 dark:text-teal-300";

export const TIER_LABELS: Record<string, string> = {
  "1": "Tier 1: Bosnia or worldwide",
  "2": "Tier 2: region, no EU permit",
  "3": "Tier 3: eligibility unclear",
};

export function fitStyle(fit: number | null): string {
  if (fit == null) return "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400";
  if (fit >= 70) return "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300";
  if (fit >= 55) return "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300";
  return "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400";
}
