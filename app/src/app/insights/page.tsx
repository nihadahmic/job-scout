import Link from "next/link";
import { Nav } from "@/components/Nav";
import { addDays, daysBetween, isDay, longDay, shortDay, today, weekStart } from "@/lib/dates";
import { CATEGORY_LABELS, SOURCE_LABELS, STATUS_COLORS, STATUS_LABELS, type Status } from "@/lib/labels";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const FOLLOW_UP_DAYS = 10;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

type App = {
  id: string;
  company: string;
  title: string;
  source: string;
  category: string | null;
  status: Status;
  url: string;
  applied_at: string;
  applied_day: string;
  replied_at: string | null;
  interviewed: boolean;
  offered: boolean;
  last_change_at: string;
};

const RANGES = { "90": "Last 90 days", "365": "Last 12 months", all: "All time" } as const;

export default async function InsightsPage({
  searchParams,
}: {
  searchParams: Promise<{ day?: string; week?: string; range?: string; month?: string }>;
}) {
  const params = await searchParams;
  const range = (params.range && params.range in RANGES ? params.range : "all") as keyof typeof RANGES;
  const supabase = await createClient();
  const [{ data, error }, { data: profileRow }] = await Promise.all([
    supabase
      .from("applications")
      .select("id, company, title, source, category, status, url, applied_at, applied_day, replied_at, interviewed, offered, last_change_at")
      .order("applied_at", { ascending: false })
      .limit(5000),
    supabase.from("profile").select("weekly_goal").maybeSingle(),
  ]);
  const goal = profileRow?.weekly_goal ?? null;
  const apps = (data ?? []) as App[];
  const now = today();
  const thisWeek = weekStart(now);

  // Counts per day and per week
  const perDay = new Map<string, number>();
  for (const a of apps) perDay.set(a.applied_day, (perDay.get(a.applied_day) ?? 0) + 1);
  const weekCount = (start: string) => {
    let n = 0;
    for (let i = 0; i < 7; i++) n += perDay.get(addDays(start, i)) ?? 0;
    return n;
  };
  const lastWeek = weekCount(addDays(thisWeek, -7));
  const avg4 = Math.round(([1, 2, 3, 4].reduce((s, i) => s + weekCount(addDays(thisWeek, -7 * i)), 0) / 4) * 10) / 10;

  // Funnel for the chosen range
  const since = range === "all" ? null : addDays(now, -Number(range));
  const inRange = apps.filter((a) => !since || a.applied_day >= since);
  const replied = inRange.filter((a) => a.replied_at).length;
  const interviewed = inRange.filter((a) => a.interviewed).length;
  const offered = inRange.filter((a) => a.offered).length;
  const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : "–");
  const replyDays = inRange
    .filter((a) => a.replied_at)
    .map((a) => (new Date(a.replied_at!).getTime() - new Date(a.applied_at).getTime()) / 86_400_000)
    .sort((x, y) => x - y);
  const medianReply = replyDays.length ? Math.round(replyDays[Math.floor(replyDays.length / 2)]) : null;

  // Breakdowns
  const breakdown = (key: (a: App) => string) => {
    const m = new Map<string, { n: number; r: number; i: number }>();
    for (const a of inRange) {
      const k = key(a);
      const v = m.get(k) ?? { n: 0, r: 0, i: 0 };
      v.n++;
      if (a.replied_at) v.r++;
      if (a.interviewed) v.i++;
      m.set(k, v);
    }
    return [...m.entries()].sort((a, b) => b[1].n - a[1].n);
  };
  const bySource = breakdown((a) => SOURCE_LABELS[a.source] ?? a.source);
  const byCategory = breakdown((a) => CATEGORY_LABELS[a.category ?? ""] ?? "Other");

  // Month calendar (Monday to Sunday) and the year around it
  const thisMonth = now.slice(0, 7);
  const month = /^\d{4}-\d{2}$/.test(params.month ?? "") && params.month! <= thisMonth ? params.month! : thisMonth;
  const [year, monthNo] = month.split("-").map(Number);
  const monthStart = `${month}-01`;
  const monthEnd = new Date(Date.UTC(year, monthNo, 0)).toISOString().slice(0, 10);
  const gridStart = weekStart(monthStart);
  const gridWeeks: string[] = [];
  for (let w = gridStart; w <= monthEnd; w = addDays(w, 7)) gridWeeks.push(w);
  const monthTotal = apps.filter((a) => a.applied_day.startsWith(month)).length;
  const shiftMonth = (delta: number) => {
    const d = new Date(Date.UTC(year, monthNo - 1 + delta, 1));
    return d.toISOString().slice(0, 7);
  };
  const monthName = new Date(Date.UTC(year, monthNo - 1, 1)).toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  const maxDay = Math.max(1, ...[...perDay.values()]);
  const shade = (n: number) =>
    n === 0
      ? "bg-white dark:bg-zinc-950"
      : n / maxDay < 0.34
        ? "bg-sky-100 dark:bg-sky-950"
        : n / maxDay < 0.67
          ? "bg-sky-300 dark:bg-sky-800"
          : "bg-sky-500 text-white dark:bg-sky-600";
  const yearCounts = MONTHS.map((_, i) => {
    const key = `${year}-${String(i + 1).padStart(2, "0")}`;
    return { key, n: apps.filter((a) => a.applied_day.startsWith(key)).length };
  });
  const maxMonth = Math.max(1, ...yearCounts.map((m) => m.n));
  const yearTotal = yearCounts.reduce((sum, m) => sum + m.n, 0);
  const href = (extra: Record<string, string>) =>
    `/insights?${new URLSearchParams({ month, range, ...extra }).toString()}`;

  // Selected day or week
  const selDay = isDay(params.day) ? params.day : null;
  const selWeek = !selDay && isDay(params.week) ? weekStart(params.week) : null;
  const selected = selDay
    ? apps.filter((a) => a.applied_day === selDay)
    : selWeek
      ? apps.filter((a) => a.applied_day >= selWeek && a.applied_day <= addDays(selWeek, 6))
      : null;

  // Pipeline
  const active = (s: Status) => apps.filter((a) => a.status === s);
  const waiting = active("applied").filter(
    (a) => daysBetween(a.last_change_at.slice(0, 10), now) >= FOLLOW_UP_DAYS,
  ).length;

  return (
    <main className="mx-auto max-w-6xl px-4 py-6">
      <Nav active="/insights" />
      {error && (
        <p className="mb-4 rounded-md bg-rose-50 p-3 text-sm text-rose-800 dark:bg-rose-950 dark:text-rose-200">
          {error.message}
        </p>
      )}

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi
          label="Applied this week"
          value={goal ? `${weekCount(thisWeek)} / ${goal}` : weekCount(thisWeek)}
          sub={`since Mon ${shortDay(thisWeek)}`}
          progress={goal ? Math.min(1, weekCount(thisWeek) / goal) : undefined}
        />
        <Kpi label="Last week" value={lastWeek} sub={`4-week average ${avg4}`} />
        <Kpi label={`Reply rate · ${RANGES[range].toLowerCase()}`} value={pct(replied, inRange.length)} sub={`${replied} of ${inRange.length}${medianReply != null ? ` · median ${medianReply} days` : ""}`} />
        <Kpi label="In interviews now" value={active("interviewing").length} sub={`${active("offer").length} at offer stage`} />
      </section>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Card
          title={`${monthName} · ${monthTotal} applied`}
          right={
            <span className="flex items-center gap-1 text-sm">
              <Link href={href({ month: shiftMonth(-1) })} className="btn-ghost px-2 py-0.5" aria-label="Previous month">
                ‹
              </Link>
              {month !== thisMonth && (
                <Link href={href({ month: thisMonth })} className="btn-ghost px-2 py-0.5 text-xs">
                  This month
                </Link>
              )}
              {month < thisMonth && (
                <Link href={href({ month: shiftMonth(1) })} className="btn-ghost px-2 py-0.5" aria-label="Next month">
                  ›
                </Link>
              )}
            </span>
          }
        >
          <div className="grid grid-cols-[repeat(7,minmax(0,1fr))_56px] gap-1 text-center">
            {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
              <span key={d} className="pb-1 text-[11px] text-zinc-500">
                {d}
              </span>
            ))}
            <span className="pb-1 text-[11px] text-zinc-500">Week</span>
            {gridWeeks.map((w) => {
              const total = weekCount(w);
              return [
                ...Array.from({ length: 7 }, (_, i) => {
                  const day = addDays(w, i);
                  const inMonth = day.startsWith(month);
                  const future = day > now;
                  const n = perDay.get(day) ?? 0;
                  const cell = (
                    <>
                      <span className="block text-left text-[11px] opacity-70">{Number(day.slice(8))}</span>
                      <span className="block text-lg font-semibold tabular-nums leading-tight">{n || ""}</span>
                    </>
                  );
                  const cls = `h-14 rounded-md border p-1 ${
                    day === selDay ? "border-zinc-900 dark:border-zinc-100" : "border-zinc-200 dark:border-zinc-800"
                  } ${shade(n)} ${inMonth ? "" : "opacity-40"} ${day === now ? "ring-2 ring-sky-400" : ""}`;
                  return future ? (
                    <span key={day} className={`${cls} opacity-30`}>{cell}</span>
                  ) : (
                    <Link key={day} href={href({ day })} title={`${shortDay(day)}: ${n} applied`} className={`${cls} hover:border-zinc-400`}>
                      {cell}
                    </Link>
                  );
                }),
                <Link
                  key={`${w}-total`}
                  href={href({ week: w })}
                  title={`Week of ${shortDay(w)}`}
                  className={`flex h-14 flex-col items-center justify-center rounded-md text-sm tabular-nums hover:bg-zinc-100 dark:hover:bg-zinc-900 ${
                    w === selWeek ? "bg-zinc-100 dark:bg-zinc-900" : ""
                  } ${goal && total >= goal ? "text-emerald-700 dark:text-emerald-400" : ""}`}
                >
                  <span className="font-semibold">{total}</span>
                  {goal ? <span className="text-[10px] text-zinc-500">of {goal}</span> : null}
                </Link>,
              ];
            })}
          </div>
          <p className="mt-2 text-xs text-zinc-500">Click a day or a week total to list the applications.</p>
        </Card>

        <div className="flex flex-col gap-4">
        <Card title={`${year} · ${yearTotal} applied`}>
          <div className="flex h-28 items-end gap-1">
            {yearCounts.map((m, i) => (
              <Link
                key={m.key}
                href={href({ month: m.key })}
                title={`${MONTHS[i]} ${year}: ${m.n}`}
                className="group flex flex-1 flex-col items-center justify-end"
              >
                <span className="mb-0.5 text-[11px] tabular-nums text-zinc-500">{m.n || ""}</span>
                <span
                  className={`w-full rounded-t ${m.key === month ? "bg-sky-600" : "bg-sky-200 group-hover:bg-sky-300 dark:bg-sky-900"}`}
                  style={{ height: `${Math.max(2, (m.n / maxMonth) * 100)}%` }}
                />
              </Link>
            ))}
          </div>
          <div className="mt-1 grid grid-cols-12 text-center text-[10px] text-zinc-500">
            {MONTHS.map((m) => (
              <span key={m}>{m[0]}</span>
            ))}
          </div>
        </Card>

        <Card
          title="Funnel"
          right={
            <span className="flex gap-1 text-xs">
              {Object.entries(RANGES).map(([k, label]) => (
                <Link
                  key={k}
                  href={href({ range: k })}
                  className={`rounded px-1.5 py-0.5 ${k === range ? "bg-zinc-200 dark:bg-zinc-700" : "text-zinc-500 hover:underline"}`}
                >
                  {label}
                </Link>
              ))}
            </span>
          }
        >
          {[
            ["Applied", inRange.length],
            ["Replied", replied],
            ["Interviewed", interviewed],
            ["Offer", offered],
          ].map(([label, n]) => (
            <div key={label as string} className="mb-2 grid grid-cols-[90px_1fr_70px] items-center gap-2 text-sm">
              <span>{label}</span>
              <span className="h-2.5 rounded bg-zinc-100 dark:bg-zinc-800">
                <span
                  className="block h-2.5 rounded bg-sky-500"
                  style={{ width: inRange.length ? `${((n as number) / inRange.length) * 100}%` : 0 }}
                />
              </span>
              <span className="text-right tabular-nums">
                {n as number} <span className="text-xs text-zinc-500">{label === "Applied" ? "" : pct(n as number, inRange.length)}</span>
              </span>
            </div>
          ))}
          <p className="mt-2 text-xs text-zinc-500">
            A reply is any answer after applying, including a rejection.
          </p>
        </Card>
        </div>
      </div>

      {selected && (
        <Card
          className="mt-4"
          title={`${selDay ? longDay(selDay) : `Week of ${longDay(selWeek!)}`} · ${selected.length} applied`}
          right={<Link href={href({})} className="text-xs text-zinc-500 hover:underline">Clear</Link>}
        >
          <AppList apps={selected} />
        </Card>
      )}

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <Card title={`By source · ${RANGES[range].toLowerCase()}`}>
          <Breakdown rows={bySource} />
        </Card>
        <Card title={`By category · ${RANGES[range].toLowerCase()}`}>
          <Breakdown rows={byCategory} />
        </Card>
      </div>

      {waiting > 0 && (
        <p className="mt-4 rounded-md bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
          {waiting} applied {waiting === 1 ? "job has" : "jobs have"} had no reply for {FOLLOW_UP_DAYS}+ days.{" "}
          <Link href="/pipeline" className="underline">
            Open the pipeline
          </Link>
        </p>
      )}

      <p className="mt-6 text-xs text-zinc-500">
        Days and weeks are in Sarajevo time, weeks start on Monday. Applications imported from Notion use the Notion
        page&apos;s dates.{" "}
        <a href="/insights/export" className="underline">
          Download all applications (CSV)
        </a>
      </p>
    </main>
  );
}

function Kpi({
  label,
  value,
  sub,
  progress,
}: {
  label: string;
  value: string | number;
  sub: string;
  progress?: number;
}) {
  return (
    <div className="rounded-lg bg-zinc-100 p-3 dark:bg-zinc-900">
      <p className="text-xs text-zinc-500">{label}</p>
      <p className="text-2xl font-semibold tabular-nums">{value}</p>
      {progress != null && (
        <div className="my-1 h-1.5 rounded bg-zinc-200 dark:bg-zinc-800">
          <div
            className={`h-1.5 rounded ${progress >= 1 ? "bg-emerald-500" : "bg-sky-500"}`}
            style={{ width: `${Math.round(progress * 100)}%` }}
          />
        </div>
      )}
      <p className="text-xs text-zinc-500">{sub}</p>
    </div>
  );
}

function Card({
  title,
  right,
  className = "",
  children,
}: {
  title: string;
  right?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={`rounded-lg border border-zinc-200 p-4 dark:border-zinc-800 ${className}`}>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium">{title}</h2>
        {right}
      </div>
      {children}
    </section>
  );
}

function Breakdown({ rows }: { rows: [string, { n: number; r: number; i: number }][] }) {
  if (!rows.length) return <p className="text-sm text-zinc-500">No applications in this range.</p>;
  return (
    <table className="w-full text-sm">
      <thead className="text-left text-xs text-zinc-500">
        <tr>
          <th className="pb-1 font-normal"></th>
          <th className="pb-1 text-right font-normal">Applied</th>
          <th className="pb-1 text-right font-normal">Replied</th>
          <th className="pb-1 text-right font-normal">Interviewed</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([name, v]) => (
          <tr key={name} className="border-t border-zinc-100 dark:border-zinc-800">
            <td className="py-1">{name}</td>
            <td className="py-1 text-right tabular-nums">{v.n}</td>
            <td className="py-1 text-right tabular-nums">
              {v.r} <span className="text-xs text-zinc-500">{Math.round((v.r / v.n) * 100)}%</span>
            </td>
            <td className="py-1 text-right tabular-nums">{v.i}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function AppList({ apps }: { apps: App[] }) {
  if (!apps.length) return <p className="text-sm text-zinc-500">Nothing applied that day.</p>;
  return (
    <ul className="divide-y divide-zinc-100 text-sm dark:divide-zinc-800">
      {apps.map((a) => (
        <li key={a.id} className="flex items-center justify-between gap-3 py-1.5">
          <Link href={`/job?id=${encodeURIComponent(a.id)}`} className="hover:underline">
            <span className="font-medium">{a.company}</span> · {a.title}
          </Link>
          <span className="flex items-center gap-2 text-xs text-zinc-500">
            {shortDay(a.applied_day)}
            <span className={`rounded-full px-2 py-0.5 font-medium ${STATUS_COLORS[a.status]}`}>{STATUS_LABELS[a.status]}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
