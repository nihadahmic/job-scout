import Link from "next/link";
import { Nav } from "@/components/Nav";
import { addDays, daysBetween, isDay, longDay, shortDay, today, weekStart } from "@/lib/dates";
import { CATEGORY_LABELS, SOURCE_LABELS, STATUS_COLORS, STATUS_LABELS, type Status } from "@/lib/labels";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const WEEKS_IN_CHART = 12;
const WEEKS_IN_CALENDAR = 26;
const FOLLOW_UP_DAYS = 10;

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
  searchParams: Promise<{ day?: string; week?: string; range?: string }>;
}) {
  const params = await searchParams;
  const range = (params.range && params.range in RANGES ? params.range : "all") as keyof typeof RANGES;
  const supabase = await createClient();
  const [{ data, error }] = await Promise.all([
    supabase
      .from("applications")
      .select("id, company, title, source, category, status, url, applied_at, applied_day, replied_at, interviewed, offered, last_change_at")
      .order("applied_at", { ascending: false })
      .limit(5000),
  ]);
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
  const weeks = Array.from({ length: WEEKS_IN_CHART }, (_, i) => addDays(thisWeek, -7 * (WEEKS_IN_CHART - 1 - i)));
  const weekCounts = weeks.map(weekCount);
  const maxWeek = Math.max(1, ...weekCounts);
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

  // Calendar
  const calStart = addDays(thisWeek, -7 * (WEEKS_IN_CALENDAR - 1));
  const shade = (n: number) =>
    n === 0
      ? "bg-zinc-100 dark:bg-zinc-800"
      : n === 1
        ? "bg-sky-200 dark:bg-sky-900"
        : n <= 3
          ? "bg-sky-400 dark:bg-sky-700"
          : "bg-sky-600 dark:bg-sky-500";

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
        <Kpi label="Applied this week" value={weekCount(thisWeek)} sub={`since Mon ${shortDay(thisWeek)}`} />
        <Kpi label="Last week" value={lastWeek} sub={`4-week average ${avg4}`} />
        <Kpi label={`Reply rate · ${RANGES[range].toLowerCase()}`} value={pct(replied, inRange.length)} sub={`${replied} of ${inRange.length}${medianReply != null ? ` · median ${medianReply} days` : ""}`} />
        <Kpi label="In interviews now" value={active("interviewing").length} sub={`${active("offer").length} at offer stage`} />
      </section>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Card title="Applications per week">
          <div className="flex h-36 items-end gap-1.5 border-b border-zinc-200 dark:border-zinc-800">
            {weeks.map((w, i) => (
              <Link
                key={w}
                href={`/insights?week=${w}&range=${range}`}
                title={`Week of ${shortDay(w)}: ${weekCounts[i]}`}
                className="group flex flex-1 flex-col items-center justify-end"
              >
                <span className="mb-0.5 text-[11px] text-zinc-500">{weekCounts[i] || ""}</span>
                <span
                  className={`w-full rounded-t ${w === thisWeek ? "bg-sky-600" : "bg-sky-300 group-hover:bg-sky-400 dark:bg-sky-800"}`}
                  style={{ height: `${Math.max(2, (weekCounts[i] / maxWeek) * 100)}%` }}
                />
              </Link>
            ))}
          </div>
          <div className="mt-1 flex justify-between text-[11px] text-zinc-500">
            <span>{shortDay(weeks[0])}</span>
            <span>this week</span>
          </div>
        </Card>

        <Card
          title="Funnel"
          right={
            <span className="flex gap-1 text-xs">
              {Object.entries(RANGES).map(([k, label]) => (
                <Link
                  key={k}
                  href={`/insights?range=${k}`}
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

      <Card title={`Applications per day · last ${WEEKS_IN_CALENDAR} weeks`} className="mt-4" right={<span className="text-xs text-zinc-500">Click a day to list it</span>}>
        <div className="flex gap-2 overflow-x-auto">
          <div className="grid grid-rows-7 gap-[3px] pt-0 text-[10px] leading-[12px] text-zinc-500">
            {["Mon", "", "Wed", "", "Fri", "", "Sun"].map((d, i) => (
              <span key={i}>{d}</span>
            ))}
          </div>
          <div className="grid grid-flow-col grid-rows-7 gap-[3px]">
            {Array.from({ length: WEEKS_IN_CALENDAR * 7 }, (_, i) => {
              const day = addDays(calStart, i);
              if (day > now) return <span key={day} className="h-3 w-3" />;
              const n = perDay.get(day) ?? 0;
              return (
                <Link
                  key={day}
                  href={`/insights?day=${day}&range=${range}`}
                  title={`${shortDay(day)}: ${n} applied`}
                  className={`h-3 w-3 rounded-[2px] ${shade(n)} ${day === selDay ? "ring-2 ring-zinc-900 dark:ring-zinc-100" : ""}`}
                />
              );
            })}
          </div>
        </div>
      </Card>

      {selected && (
        <Card
          className="mt-4"
          title={`${selDay ? longDay(selDay) : `Week of ${longDay(selWeek!)}`} · ${selected.length} applied`}
          right={<Link href={`/insights?range=${range}`} className="text-xs text-zinc-500 hover:underline">Clear</Link>}
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

function Kpi({ label, value, sub }: { label: string; value: string | number; sub: string }) {
  return (
    <div className="rounded-lg bg-zinc-100 p-3 dark:bg-zinc-900">
      <p className="text-xs text-zinc-500">{label}</p>
      <p className="text-2xl font-semibold tabular-nums">{value}</p>
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
