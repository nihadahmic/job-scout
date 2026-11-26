/**
 * Is a job posting still up? Company boards are asked through their APIs (reliable); other
 * links are loaded and read. Anything ambiguous (bot protection, login walls, timeouts) is
 * "unknown", never "removed".
 */

export type PostingState = { state: "live" | "removed" | "unknown"; how: string };

type JobRef = { source: string; source_id: string; url: string; apply_url: string | null };

const TIMEOUT = 8_000;
const UA = "Mozilla/5.0 (compatible; job-scout posting check)";
const REMOVED_TEXT =
  /(no longer (available|accepting|open|active)|position (has been|is) (filled|closed)|job (is )?(not found|closed|expired)|this (job|posting|role|vacancy) (has )?(expired|closed|been removed)|page (you're|you are) looking for (doesn't|does not) exist|posting (is )?not found)/i;

async function get(url: string, init: RequestInit = {}): Promise<Response | null> {
  try {
    return await fetch(url, {
      redirect: "follow",
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT),
      headers: { "User-Agent": UA, Accept: "text/html,application/json;q=0.9,*/*;q=0.8" },
      ...init,
    });
  } catch {
    return null;
  }
}

function split(sourceId: string): [string, string] {
  const i = sourceId.indexOf("/");
  return [sourceId.slice(0, i), sourceId.slice(i + 1)];
}

async function viaAts(job: JobRef): Promise<PostingState | null> {
  const [slug, id] = split(job.source_id);
  if (!slug || !id) return null;
  const gone = (r: Response | null, how: string): PostingState | null =>
    !r ? null : r.status === 404 || r.status === 410 ? { state: "removed", how } : r.ok ? { state: "live", how } : null;

  switch (job.source) {
    case "greenhouse":
      return gone(await get(`https://boards-api.greenhouse.io/v1/boards/${slug}/jobs/${id}`), "Greenhouse API");
    case "lever": {
      const r = (await get(`https://api.lever.co/v0/postings/${slug}/${id}`)) ?? null;
      return r && r.status === 404 ? gone(await get(`https://api.eu.lever.co/v0/postings/${slug}/${id}`), "Lever API") : gone(r, "Lever API");
    }
    case "smartrecruiters": {
      const r = await get(`https://api.smartrecruiters.com/v1/companies/${slug}/postings/${id}`);
      // SmartRecruiters answers 400 or 404 for postings that were removed.
      if (r && (r.status === 400 || r.status === 404)) return { state: "removed", how: "SmartRecruiters API" };
      return gone(r, "SmartRecruiters API");
    }
    case "ashby":
    case "workable":
    case "recruitee": {
      const board =
        job.source === "ashby"
          ? `https://api.ashbyhq.com/posting-api/job-board/${slug}`
          : job.source === "workable"
            ? `https://apply.workable.com/api/v1/widget/accounts/${slug}`
            : `https://${slug}.recruitee.com/api/offers/`;
      const r = await get(board);
      if (!r?.ok) return null;
      const data = await r.json().catch(() => null);
      const list: Record<string, unknown>[] = data?.jobs ?? data?.offers ?? [];
      if (!Array.isArray(list)) return null;
      const key = job.source === "workable" ? "shortcode" : "id";
      const found = list.some((j) => String(j[key]) === id);
      return { state: found ? "live" : "removed", how: `${job.source[0].toUpperCase()}${job.source.slice(1)} board` };
    }
  }
  return null;
}

async function viaPage(url: string): Promise<PostingState> {
  if (!/^https?:\/\//i.test(url)) return { state: "unknown", how: "not a web link" };
  if (/linkedin\.com/i.test(url)) return { state: "unknown", how: "LinkedIn can't be checked automatically" };
  const r = await get(url);
  if (!r) return { state: "unknown", how: "the page didn't answer" };
  if (r.status === 404 || r.status === 410) return { state: "removed", how: `the page returned ${r.status}` };
  if (r.status >= 400) return { state: "unknown", how: `the page returned ${r.status}` };
  const text = (await r.text().catch(() => "")).slice(0, 300_000).replace(/<[^>]+>/g, " ");
  if (REMOVED_TEXT.test(text)) return { state: "removed", how: "the page says the job is no longer available" };
  return { state: "live", how: "the page loads" };
}

const BOARD_LINKS: [string, RegExp][] = [
  ["greenhouse", /(?:job-)?boards(?:\.eu)?\.greenhouse\.io\/([^/?#]+)\/jobs\/(\d+)/i],
  ["lever", /jobs(?:\.eu)?\.lever\.co\/([^/?#]+)\/([0-9a-f-]{36})/i],
  ["ashby", /jobs\.ashbyhq\.com\/([^/?#]+)\/([0-9a-f-]{36})/i],
  ["smartrecruiters", /jobs\.smartrecruiters\.com\/([^/?#]+)\/(\d+)/i],
];

export async function checkPosting(job: JobRef): Promise<PostingState> {
  const ats = await viaAts(job).catch(() => null);
  if (ats) return ats;
  // Links to company boards from other sources (e.g. imported from Notion): use the board's API.
  for (const url of [job.url, job.apply_url ?? ""]) {
    for (const [source, pattern] of BOARD_LINKS) {
      const m = url.match(pattern);
      if (!m) continue;
      const r = await viaAts({ ...job, source, source_id: `${m[1]}/${m[2]}` }).catch(() => null);
      if (r) return r;
    }
  }
  return viaPage(job.url);
}
