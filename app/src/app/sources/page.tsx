import { Nav } from "@/components/Nav";
import { SourcesUI, type BuiltIn, type Company, type Feed, type Request } from "@/components/SourcesUI";
import { SOURCE_LABELS } from "@/lib/labels";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
// Detecting a company's ATS fetches its careers page and can take a few seconds.
export const maxDuration = 60;

const BOARDS = ["himalayas", "remotive", "weworkremotely", "notion"];
const ATS = ["greenhouse", "lever", "ashby", "workable", "recruitee", "teamtailor", "personio", "breezy", "smartrecruiters", "bamboohr", "pinpoint"];

export default async function SourcesPage() {
  const supabase = await createClient();
  const [watchlist, feeds, requests, settings, lastRun] = await Promise.all([
    supabase.from("watchlist").select("*").order("name").limit(5000),
    supabase.from("feeds").select("*").order("added_at", { ascending: false }),
    supabase.from("source_requests").select("*").order("created_at", { ascending: false }),
    supabase.from("source_settings").select("source, enabled"),
    supabase.from("runs").select("summary").order("started_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const error = watchlist.error ?? feeds.error ?? requests.error ?? settings.error;
  const enabled = new Map((settings.data ?? []).map((s) => [s.source, s.enabled]));
  const summary = (lastRun.data?.summary ?? {}) as Record<string, { fetched?: number; new?: number }>;
  // Your Notion "Applications" database: pages read and jobs added, from the run's notes.
  const notion = ((summary as Record<string, unknown>)._meta as { notion?: Record<string, number> } | undefined)?.notion;
  if (notion) summary.notion = { fetched: notion.pages, new: (notion.new_saved ?? 0) + (notion.new_tracked ?? 0) };
  const builtIns: BuiltIn[] = [...BOARDS, ...ATS].map((source) => ({
    source,
    label: SOURCE_LABELS[source] ?? source,
    enabled: enabled.get(source) ?? true,
    fetched: summary[source]?.fetched ?? null,
    added: summary[source]?.new ?? null,
    kind: ATS.includes(source) ? "ats" : "board",
  }));

  return (
    <main className="mx-auto max-w-6xl px-4 py-6">
      <Nav active="/sources" />
      {error && (
        <p className="mb-4 rounded-md bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
          {error.message}. If this is new, run migration 0011 in Supabase.
        </p>
      )}
      <SourcesUI
        builtIns={builtIns}
        companies={(watchlist.data ?? []) as Company[]}
        feeds={(feeds.data ?? []) as Feed[]}
        requests={(requests.data ?? []) as Request[]}
      />
    </main>
  );
}
