"use client";

import { useMemo, useState, useTransition } from "react";
import {
  addCompany,
  addFeed,
  addRequest,
  checkBoard,
  checkFeed,
  detect,
  removeCompany,
  removeFeed,
  setSourceEnabled,
  updateCompany,
  updateFeed,
  updateRequest,
} from "@/app/sources/actions";
import type { Detection, FeedPreview } from "@/lib/sources";

export type Company = {
  id: number;
  name: string;
  website: string;
  ats: string;
  slug: string | null;
  board_name: string | null;
  ats_note: string | null;
  paused: boolean;
  last_checked_at: string | null;
  last_fetched: number | null;
  last_kept: number | null;
  last_new: number | null;
  last_error: string | null;
  last_kept_at: string | null;
};
export type Feed = {
  id: number;
  name: string;
  url: string;
  all_remote: boolean;
  paused: boolean;
  last_checked_at: string | null;
  last_fetched: number | null;
  last_kept: number | null;
  last_new: number | null;
  last_error: string | null;
};
export type Request = { id: number; name: string; url: string | null; note: string | null; status: "open" | "done" | "declined"; created_at: string };
export type BuiltIn = { source: string; label: string; enabled: boolean; fetched: number | null; added: number | null; kind: "board" | "ats" };

const ATS_LABELS: Record<string, string> = {
  greenhouse: "Greenhouse", lever: "Lever", ashby: "Ashby", workable: "Workable", recruitee: "Recruitee",
  teamtailor: "Teamtailor", personio: "Personio", breezy: "Breezy", smartrecruiters: "SmartRecruiters",
  bamboohr: "BambooHR", pinpoint: "Pinpoint", unknown: "Unknown",
};

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
      <h2 className="text-base font-semibold">{title}</h2>
      {hint && <p className="mb-3 text-sm text-zinc-500">{hint}</p>}
      {children}
    </section>
  );
}

function day(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Europe/Sarajevo" }) : "";
}

function Stat({ fetched, kept, added, error, checked }: { fetched: number | null; kept: number | null; added: number | null; error: string | null; checked: string | null }) {
  if (error) return <span className="text-xs text-rose-600" title={error}>Error: {error.slice(0, 40)}</span>;
  if (!checked) return <span className="text-xs text-zinc-400">Not run yet</span>;
  return (
    <span className="text-xs tabular-nums text-zinc-600 dark:text-zinc-400">
      {fetched ?? 0} listed · {kept ?? 0} kept{added ? ` · ${added} new` : ""}
    </span>
  );
}

export function SourcesUI({ builtIns, companies, feeds, requests }: { builtIns: BuiltIn[]; companies: Company[]; feeds: Feed[]; requests: Request[] }) {
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const act = (fn: () => Promise<{ ok: boolean; error?: string }>, success?: string) =>
    start(async () => {
      const r = await fn();
      setMessage(r.ok ? (success ? { ok: true, text: success } : null) : { ok: false, text: r.error ?? "Failed" });
    });

  return (
    <div className="flex flex-col gap-6">
      {message && (
        <p className={`rounded-md p-2 text-sm ${message.ok ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300" : "bg-rose-50 text-rose-800 dark:bg-rose-950 dark:text-rose-200"}`}>
          {message.text}
        </p>
      )}

      <Section title="Built-in sources" hint="Switch a whole source off or on. Counts are from the last run.">
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {builtIns.map((b) => (
            <li key={b.source} className="flex items-center justify-between rounded-lg border border-zinc-200 px-3 py-2 dark:border-zinc-800">
              <span>
                <span className="text-sm font-medium">{b.label}</span>
                <span className="block text-xs text-zinc-500">
                  {b.kind === "ats" ? "Company boards · " : ""}
                  {b.fetched != null ? `${b.fetched} listed, ${b.added ?? 0} new last run` : "no run yet"}
                </span>
              </span>
              <label className="flex items-center gap-2 text-xs">
                <input type="checkbox" checked={b.enabled} disabled={pending} onChange={(e) => act(() => setSourceEnabled(b.source, e.target.checked))} />
                {b.enabled ? "On" : "Off"}
              </label>
            </li>
          ))}
        </ul>
      </Section>

      <CompaniesSection companies={companies} pending={pending} act={act} />
      <FeedsSection feeds={feeds} pending={pending} act={act} />
      <RequestsSection requests={requests} pending={pending} act={act} />
    </div>
  );
}

type Act = (fn: () => Promise<{ ok: boolean; error?: string }>, success?: string) => void;

function CompaniesSection({ companies, pending, act }: { companies: Company[]; pending: boolean; act: Act }) {
  const [website, setWebsite] = useState("");
  const [name, setName] = useState("");
  const [found, setFound] = useState<Detection | null>(null);
  const [ats, setAts] = useState("unknown");
  const [slug, setSlug] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [atsFilter, setAtsFilter] = useState("readable");
  const [editing, setEditing] = useState<number | null>(null);
  const [editAts, setEditAts] = useState("unknown");
  const [editSlug, setEditSlug] = useState("");

  const counts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const c of companies) m[c.ats] = (m[c.ats] ?? 0) + 1;
    return m;
  }, [companies]);
  const shown = companies
    .filter((c) => (atsFilter === "all" ? true : atsFilter === "readable" ? c.ats !== "unknown" : atsFilter === "paused" ? c.paused : c.ats === atsFilter))
    .filter((c) => !query || `${c.name} ${c.website} ${c.slug ?? ""}`.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => (b.last_kept ?? 0) - (a.last_kept ?? 0) || a.name.localeCompare(b.name));

  return (
    <Section
      title={`Companies · ${companies.length}`}
      hint="Your watchlist. Each run reads every company whose board uses a supported ATS. Paste a careers page to add one."
    >
      <form
        className="mb-4 flex flex-col gap-2 rounded-lg bg-zinc-50 p-3 dark:bg-zinc-900"
        onSubmit={async (e) => {
          e.preventDefault();
          setError("");
          setFound(null);
          setBusy(true);
          const r = await detect(website, name);
          setBusy(false);
          if (!r.ok) return setError(r.error);
          setFound(r.value);
          setAts(r.value.ats);
          setSlug(r.value.slug ?? "");
        }}
      >
        <div className="flex flex-wrap gap-2">
          <input value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="Careers page, e.g. https://n8n.io/careers" className="field min-w-0 flex-[2]" required />
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Company name (optional)" className="field min-w-0 flex-1" />
          <button className="btn" disabled={busy || !website.trim()}>{busy ? "Checking…" : "Detect"}</button>
        </div>
        {error && <p className="text-sm text-rose-600">{error}</p>}
        {found && (
          <div className="rounded-md border border-zinc-200 bg-white p-3 text-sm dark:border-zinc-800 dark:bg-zinc-950">
            <p>
              {found.ats === "unknown" ? (
                <>No supported ATS found ({found.note}). Pick one if you know it, or add it as unknown and ask for support below.</>
              ) : (
                <>
                  Found <b>{ATS_LABELS[found.ats]}</b> · <code>{found.slug}</code> ({found.note})
                  {found.jobs != null ? ` · ${found.jobs} open ${found.jobs === 1 ? "job" : "jobs"} right now` : " · the board didn't answer"}
                </>
              )}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <select value={ats} onChange={(e) => setAts(e.target.value)} className="field py-1 text-sm">
                {Object.entries(ATS_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
              {ats !== "unknown" && <input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="board slug" className="field py-1 text-sm" />}
              {ats !== "unknown" && (ats !== found.ats || slug !== (found.slug ?? "")) && (
                <button
                  type="button"
                  className="btn-ghost text-xs"
                  onClick={async () => {
                    const r = await checkBoard(ats, slug);
                    setFound({ ...found, ats: ats as Detection["ats"], slug, note: "set by hand", jobs: r.ok ? r.value : null });
                  }}
                >
                  Check this board
                </button>
              )}
              <button
                type="button"
                className="btn text-xs"
                disabled={pending}
                onClick={() =>
                  act(async () => {
                    const r = await addCompany({ name, website, ats, slug: slug || null, region: found.region, note: found.note });
                    if (r.ok) {
                      setWebsite("");
                      setName("");
                      setFound(null);
                    }
                    return r;
                  }, "Added. The next run will read it.")
                }
              >
                Add to watchlist
              </button>
            </div>
          </div>
        )}
      </form>

      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search companies" className="field py-1 text-sm" />
        {[
          ["readable", `Readable (${companies.length - (counts.unknown ?? 0)})`],
          ["all", `All (${companies.length})`],
          ["unknown", `Unknown ATS (${counts.unknown ?? 0})`],
          ["paused", "Paused"],
          ...Object.entries(counts).filter(([k]) => k !== "unknown").sort((a, b) => b[1] - a[1]).map(([k, n]) => [k, `${ATS_LABELS[k] ?? k} (${n})`]),
        ].map(([k, l]) => (
          <button key={k} type="button" onClick={() => setAtsFilter(k)} className={`rounded-full border px-2 py-0.5 ${atsFilter === k ? "border-transparent bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "border-zinc-300 dark:border-zinc-700"}`}>
            {l}
          </button>
        ))}
      </div>
      <ul className="max-h-[32rem] divide-y divide-zinc-100 overflow-y-auto rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
        {shown.slice(0, 400).map((c) => (
          <li key={c.id} className={`flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm ${c.paused ? "opacity-50" : ""}`}>
            <span className="min-w-0 flex-1">
              <a href={c.website} target="_blank" rel="noopener noreferrer" className="font-medium hover:underline">{c.board_name || c.name}</a>
              {c.board_name && <span className="text-xs text-zinc-500"> (listed as {c.name})</span>}
              <span className="block text-xs text-zinc-500">
                {ATS_LABELS[c.ats] ?? c.ats}{c.slug ? ` · ${c.slug}` : ""}{c.last_kept_at ? ` · last useful ${day(c.last_kept_at)}` : ""}
              </span>
            </span>
            {editing === c.id ? (
              <span className="flex flex-wrap items-center gap-1">
                <select value={editAts} onChange={(e) => setEditAts(e.target.value)} className="field py-0.5 text-xs">
                  {Object.entries(ATS_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
                {editAts !== "unknown" && <input value={editSlug} onChange={(e) => setEditSlug(e.target.value)} className="field w-32 py-0.5 text-xs" placeholder="slug" />}
                <button type="button" className="btn text-xs" onClick={() => { act(() => updateCompany(c.id, { ats: editAts, slug: editSlug }), "Saved"); setEditing(null); }}>Save</button>
                <button type="button" className="btn-ghost text-xs" onClick={() => setEditing(null)}>Cancel</button>
              </span>
            ) : (
              <>
                <Stat fetched={c.last_fetched} kept={c.last_kept} added={c.last_new} error={c.last_error} checked={c.last_checked_at} />
                <span className="flex gap-1 text-xs">
                  <button type="button" className="btn-ghost text-xs" onClick={() => { setEditing(c.id); setEditAts(c.ats); setEditSlug(c.slug ?? ""); }}>ATS</button>
                  <button type="button" className="btn-ghost text-xs" disabled={pending} onClick={() => act(() => updateCompany(c.id, { paused: !c.paused }))}>{c.paused ? "Resume" : "Pause"}</button>
                  <button type="button" className="btn-ghost text-xs text-rose-600" disabled={pending} onClick={() => window.confirm(`Remove ${c.name} from the watchlist?`) && act(() => removeCompany(c.id))}>Remove</button>
                </span>
              </>
            )}
          </li>
        ))}
        {shown.length > 400 && <li className="px-3 py-2 text-xs text-zinc-500">{shown.length - 400} more. Search to narrow the list.</li>}
        {!shown.length && <li className="px-3 py-4 text-center text-sm text-zinc-500">No companies match.</li>}
      </ul>
    </Section>
  );
}

function FeedsSection({ feeds, pending, act }: { feeds: Feed[]; pending: boolean; act: Act }) {
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [allRemote, setAllRemote] = useState(true);
  const [preview, setPreview] = useState<FeedPreview | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Section title={`Feeds · ${feeds.length}`} hint="Any job board or careers page with an RSS or Atom feed. The collector reads it each run, with the same filters and screening.">
      <form
        className="mb-4 flex flex-col gap-2 rounded-lg bg-zinc-50 p-3 dark:bg-zinc-900"
        onSubmit={async (e) => {
          e.preventDefault();
          setError("");
          setPreview(null);
          setBusy(true);
          const r = await checkFeed(url);
          setBusy(false);
          if (!r.ok) return setError(r.error);
          setPreview(r.value);
          if (!name && r.value.title) setName(r.value.title.slice(0, 80));
        }}
      >
        <div className="flex flex-wrap gap-2">
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Feed URL, e.g. https://weworkremotely.com/categories/remote-product-jobs.rss" className="field min-w-0 flex-[2]" required />
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name (optional)" className="field min-w-0 flex-1" />
          <button className="btn" disabled={busy || !url.trim()}>{busy ? "Reading…" : "Preview"}</button>
        </div>
        <label className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400">
          <input type="checkbox" checked={allRemote} onChange={(e) => setAllRemote(e.target.checked)} />
          Every job in this feed is remote (a remote-only board)
        </label>
        {error && <p className="text-sm text-rose-600">{error}</p>}
        {preview && (
          <div className="rounded-md border border-zinc-200 bg-white p-3 text-sm dark:border-zinc-800 dark:bg-zinc-950">
            <p className="mb-1">Found <b>{preview.items}</b> listings{preview.title ? ` in "${preview.title}"` : ""}. First few:</p>
            <ul className="mb-2 list-disc pl-5 text-xs text-zinc-600 dark:text-zinc-400">
              {preview.sample.map((s, i) => <li key={i}>{s.title}{s.company ? ` · ${s.company}` : " · company unknown (the feed's name is used)"}</li>)}
            </ul>
            <button
              type="button"
              className="btn text-xs"
              disabled={pending || !preview.items}
              onClick={() =>
                act(async () => {
                  const r = await addFeed({ name, url, allRemote });
                  if (r.ok) {
                    setUrl("");
                    setName("");
                    setPreview(null);
                  }
                  return r;
                }, "Feed added. The next run will read it.")
              }
            >
              Add feed
            </button>
          </div>
        )}
      </form>
      <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
        {feeds.map((f) => (
          <li key={f.id} className={`flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm ${f.paused ? "opacity-50" : ""}`}>
            <span className="min-w-0 flex-1">
              <span className="font-medium">{f.name}</span>
              <span className="block truncate text-xs text-zinc-500">{f.url}</span>
            </span>
            <Stat fetched={f.last_fetched} kept={f.last_kept} added={f.last_new} error={f.last_error} checked={f.last_checked_at} />
            <label className="flex items-center gap-1 text-xs">
              <input type="checkbox" checked={f.all_remote} disabled={pending} onChange={(e) => act(() => updateFeed(f.id, { all_remote: e.target.checked }))} /> all remote
            </label>
            <button type="button" className="btn-ghost text-xs" disabled={pending} onClick={() => act(() => updateFeed(f.id, { paused: !f.paused }))}>{f.paused ? "Resume" : "Pause"}</button>
            <button type="button" className="btn-ghost text-xs text-rose-600" disabled={pending} onClick={() => window.confirm(`Remove the feed ${f.name}?`) && act(() => removeFeed(f.id))}>Remove</button>
          </li>
        ))}
        {!feeds.length && <li className="py-2 text-sm text-zinc-500">No feeds yet.</li>}
      </ul>
    </Section>
  );
}

function RequestsSection({ requests, pending, act }: { requests: Request[]; pending: boolean; act: Act }) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [note, setNote] = useState("");
  return (
    <Section
      title="Requests"
      hint="A job board with its own API, or an ATS that isn't supported yet, needs code. Add it here; in your next Claude Code session, ask to build the open requests."
    >
      <form
        className="mb-3 flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          act(async () => {
            const r = await addRequest({ name, url, note });
            if (r.ok) {
              setName("");
              setUrl("");
              setNote("");
            }
            return r;
          }, "Request saved");
        }}
      >
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name, e.g. Workday or Jobicy API" className="field min-w-0 flex-1" required />
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Example URL (optional)" className="field min-w-0 flex-1" />
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why (optional)" className="field min-w-0 flex-1" />
        <button className="btn" disabled={pending || !name.trim()}>Add request</button>
      </form>
      <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
        {requests.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
            <span className="min-w-0 flex-1">
              <span className="font-medium">{r.name}</span>
              {r.url && <span className="block truncate text-xs text-zinc-500">{r.url}</span>}
              {r.note && <span className="block text-xs text-zinc-500">{r.note}</span>}
            </span>
            <span className={`rounded-full px-2 py-0.5 text-xs ${r.status === "open" ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300" : r.status === "done" ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300" : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"}`}>{r.status}</span>
            <select value={r.status} disabled={pending} onChange={(e) => act(() => updateRequest(r.id, e.target.value as Request["status"]))} className="field py-0.5 text-xs">
              <option value="open">Open</option>
              <option value="done">Done</option>
              <option value="declined">Declined</option>
            </select>
          </li>
        ))}
        {!requests.length && <li className="py-2 text-sm text-zinc-500">No requests.</li>}
      </ul>
    </Section>
  );
}
