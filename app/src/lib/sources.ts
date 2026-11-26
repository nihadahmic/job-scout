/** Server-side helpers for the Sources page: detect a company's ATS, count its jobs, read feeds. */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { XMLParser } from "fast-xml-parser";

export const ATS_TYPES = [
  "greenhouse",
  "lever",
  "ashby",
  "workable",
  "recruitee",
  "teamtailor",
  "personio",
  "breezy",
  "smartrecruiters",
  "bamboohr",
  "pinpoint",
] as const;
export type AtsType = (typeof ATS_TYPES)[number];

const UA = "job-scout/0.1 (personal job search tool; checks careers pages once)";
const SLUG = "([A-Za-z0-9][A-Za-z0-9._-]*)";
const PATTERNS: [AtsType, RegExp, string | null][] = [
  ["greenhouse", new RegExp(`boards-api\\.greenhouse\\.io/v1/boards/${SLUG}`), null],
  ["greenhouse", new RegExp(`(?:job-)?boards\\.eu\\.greenhouse\\.io/(?:embed/job_board\\?for=)?${SLUG}`), "eu"],
  ["greenhouse", new RegExp(`(?:job-)?boards\\.greenhouse\\.io/(?:embed/job_board(?:/js)?\\?for=)?${SLUG}`), null],
  ["greenhouse", new RegExp(`greenhouse\\.io/embed/job_board(?:/js)?\\?for=${SLUG}`), null],
  ["lever", new RegExp(`jobs\\.eu\\.lever\\.co/${SLUG}`), "eu"],
  ["lever", new RegExp(`jobs\\.lever\\.co/${SLUG}`), null],
  ["ashby", new RegExp(`jobs\\.ashbyhq\\.com/${SLUG}`), null],
  ["workable", new RegExp(`apply\\.workable\\.com/(?!j/)${SLUG}`), null],
  ["personio", new RegExp(`//${SLUG}\\.jobs\\.personio\\.(?:de|com)`), null],
  ["recruitee", new RegExp(`//${SLUG}\\.recruitee\\.com`), null],
  ["smartrecruiters", new RegExp(`(?:jobs|careers)\\.smartrecruiters\\.com/${SLUG}`), null],
  ["teamtailor", new RegExp(`//${SLUG}\\.teamtailor\\.com`), null],
  ["breezy", new RegExp(`//${SLUG}\\.breezy\\.hr`), null],
  ["bamboohr", new RegExp(`//${SLUG}\\.bamboohr\\.com`), null],
  ["pinpoint", new RegExp(`//${SLUG}\\.pinpointhq\\.com`), null],
];
const NOT_SLUGS = new Set([
  "www", "apply", "api", "app", "js", "embed", "v0", "v1", "jobs", "careers", "static", "assets", "cdn",
  "images", "resources", "help", "support", "blog", "widget", "accounts", "job_board", "en", "de", "j",
  "careers-analytics", "analytics", "status", "go", "media", "fonts", "img",
]);

async function get(url: string, accept = "text/html,application/json;q=0.9,*/*;q=0.8") {
  try {
    const res = await fetch(url, {
      redirect: "follow",
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
      headers: { "User-Agent": UA, Accept: accept },
    });
    return { status: res.status, url: res.url, text: res.ok ? (await res.text()).slice(0, 2_000_000) : "" };
  } catch {
    return null;
  }
}

export type Detection = {
  ats: AtsType | "unknown";
  slug: string | null;
  region: string | null;
  note: string;
  jobs: number | null; // open jobs on the board, when it answered
};

function detectIn(text: string): { ats: AtsType; slug: string; region: string | null } | null {
  const hits = new Map<string, number>();
  for (const [ats, re, region] of PATTERNS) {
    for (const m of text.matchAll(new RegExp(re.source, "g"))) {
      let slug = m[1].replace(/^[._-]+|[._-]+$/g, "").split(/[?&#"'\\/]/)[0];
      if (!slug || NOT_SLUGS.has(slug.toLowerCase()) || slug.length > 60) continue;
      const key = `${ats}|${slug}|${region ?? ""}`;
      hits.set(key, (hits.get(key) ?? 0) + 1);
    }
  }
  if (!hits.size) return null;
  const [best] = [...hits.entries()].sort((a, b) => b[1] - a[1])[0];
  const [ats, slug, region] = best.split("|");
  return { ats: ats as AtsType, slug, region: region || null };
}

/** How many jobs a board lists right now, or null if it doesn't answer as that ATS. */
export async function countJobs(ats: AtsType, slug: string, region: string | null = null): Promise<number | null> {
  const s = encodeURIComponent(slug);
  const urls: Record<AtsType, string> = {
    greenhouse: `https://boards-api.greenhouse.io/v1/boards/${s}/jobs`,
    lever: `https://api${region === "eu" ? ".eu" : ""}.lever.co/v0/postings/${s}?mode=json`,
    ashby: `https://api.ashbyhq.com/posting-api/job-board/${s}`,
    workable: `https://apply.workable.com/api/v1/widget/accounts/${s}`,
    recruitee: `https://${s}.recruitee.com/api/offers/`,
    teamtailor: `https://${slug.includes(".") ? slug : `${s}.teamtailor.com`}/jobs.rss`,
    personio: `https://${s}.jobs.personio.de/xml`,
    breezy: `https://${s}.breezy.hr/json`,
    smartrecruiters: `https://api.smartrecruiters.com/v1/companies/${s}/postings?limit=1`,
    bamboohr: `https://${s}.bamboohr.com/careers/list`,
    pinpoint: `https://${s}.pinpointhq.com/postings.json`,
  };
  const r = await get(urls[ats]);
  if (!r || r.status !== 200) return null;
  try {
    if (ats === "teamtailor") return (r.text.match(/<item>/g) ?? []).length;
    if (ats === "personio") return r.text.includes("<workzag-jobs") ? (r.text.match(/<position>/g) ?? []).length : null;
    const d = JSON.parse(r.text);
    if (ats === "smartrecruiters") return typeof d.totalFound === "number" ? d.totalFound : null;
    const list = Array.isArray(d) ? d : (d.jobs ?? d.offers ?? d.result ?? d.data);
    return Array.isArray(list) ? list.length : null;
  } catch {
    return null;
  }
}

const CAREERS_LINK = /href=["']([^"'#]*(?:careers?|jobs|join-us|joinus|work-with-us|open-positions|vacancies)[^"'#]*)["']/gi;

/** Find a company's ATS and board from its careers page (same approach as scripts/detect_ats.py). */
export async function detectCompany(website: string, name: string): Promise<Detection> {
  const direct = detectIn(website);
  if (direct) return { ...direct, note: "from the URL", jobs: await countJobs(direct.ats, direct.slug, direct.region) };
  if (/angel\.co|wellfound\.com|linkedin\.com/i.test(website)) {
    return { ats: "unknown", slug: null, region: null, note: "login-walled site, not checked", jobs: null };
  }
  const page = await get(website);
  if (!page) return { ats: "unknown", slug: null, region: null, note: "the site didn't answer", jobs: null };
  if ([403, 429, 503].includes(page.status)) return { ats: "unknown", slug: null, region: null, note: `the site blocked the check (${page.status})`, jobs: null };
  const pages = [page];
  let found = detectIn(`${page.url} ${page.text}`);
  if (!found) {
    const host = new URL(page.url).hostname.replace(/^www\./, "");
    const link = [...page.text.matchAll(CAREERS_LINK)]
      .map((m) => new URL(m[1], page.url).toString())
      .find((u) => !/\.(css|js|xml|rss|png|svg|pdf)(\?|$)|\/feed\/?$/i.test(u) && new URL(u).hostname.replace(/^www\./, "").endsWith(host));
    const next = link ?? (new URL(page.url).pathname.replace(/\/$/, "") === "" ? new URL("/careers", page.url).toString() : null);
    if (next) {
      const second = await get(next);
      if (second?.status === 200) {
        pages.push(second);
        found = detectIn(`${second.url} ${second.text}`);
      }
    }
  }
  if (!found && /teamtailor-cdn|data-teamtailor/i.test(pages.map((p) => p.text).join(" "))) {
    found = { ats: "teamtailor", slug: new URL(pages[pages.length - 1].url).hostname, region: null };
  }
  if (!found) {
    // The page names an ATS but loads it with JavaScript: try likely slugs against that ATS.
    const text = pages.map((p) => p.text).join(" ").toLowerCase();
    const host = new URL(page.url).hostname.replace(/^www\./, "").split(".")[0];
    const guesses = [...new Set([host, name.toLowerCase().replace(/[^a-z0-9]/g, "")])].filter(Boolean);
    for (const ats of ["greenhouse", "ashby", "lever", "recruitee", "personio", "bamboohr", "pinpoint"] as AtsType[]) {
      if (!text.includes(ats === "pinpoint" ? "pinpointhq" : ats)) continue;
      for (const slug of guesses) {
        const jobs = await countJobs(ats, slug);
        if (jobs != null) return { ats, slug, region: null, note: "slug guessed, confirmed by the board", jobs };
      }
    }
    return { ats: "unknown", slug: null, region: null, note: "no supported ATS found on the careers page", jobs: null };
  }
  return { ...found, note: "found on the careers page", jobs: await countJobs(found.ats, found.slug, found.region) };
}

export type FeedPreview = { items: number; sample: { title: string; company: string; link: string }[]; title: string };

/** Read an RSS or Atom feed and show what the collector would get from it. */
export async function previewFeed(url: string): Promise<FeedPreview> {
  const r = await get(url, "application/rss+xml,application/atom+xml,application/xml,text/xml;q=0.9,*/*;q=0.5");
  if (!r) throw new Error("The feed didn't answer.");
  if (r.status !== 200) throw new Error(`The feed returned ${r.status}.`);
  // Entities are left encoded: job feeds carry long escaped HTML descriptions, which can trip
  // the parser's entity limit. The preview only needs titles and links, decoded below.
  let doc: Record<string, any>;
  try {
    doc = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, processEntities: false }).parse(r.text);
  } catch {
    throw new Error("That address doesn't contain a readable RSS or Atom feed.");
  }
  const channel = doc?.rss?.channel ?? doc?.feed ?? doc?.RDF;
  if (!channel) throw new Error("That address isn't an RSS or Atom feed.");
  const raw = channel.item ?? channel.entry ?? doc?.RDF?.item ?? [];
  const items = Array.isArray(raw) ? raw : [raw];
  const decode = (v: string) =>
    v
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;|&apos;/g, "'")
      .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
      .replace(/&amp;/g, "&");
  const text = (v: unknown): string =>
    decode(
      typeof v === "string" || typeof v === "number"
        ? String(v)
        : typeof v === "object" && v !== null && "#text" in v
          ? String((v as { "#text": unknown })["#text"])
          : "",
    );
  const sample = items.slice(0, 5).map((it: Record<string, unknown>) => {
    const title = text(it.title).trim();
    const explicit = text(it.company) || text(it.company_name);
    const m = title.match(/^([^:]{2,60}):\s+(.+)$/) ?? null;
    const at = title.match(/^(.+?)\s+(?:at|@)\s+([^,()]{2,60})$/) ?? null;
    const link = typeof it.link === "object" && it.link !== null ? String((it.link as Record<string, unknown>)["@_href"] ?? "") : text(it.link);
    return {
      title: explicit ? title : m ? m[2] : at ? at[1] : title,
      company: explicit || (m ? m[1] : at ? at[2] : ""),
      link,
    };
  });
  return { items: items.length, sample, title: text(channel.title) };
}
