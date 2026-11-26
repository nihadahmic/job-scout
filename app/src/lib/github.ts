/** GitHub Actions for the collect workflow. Server-only: GITHUB_TOKEN never reaches the browser. */

const WORKFLOW = "collect.yml";

export function githubRepo(): string | null {
  if (process.env.GITHUB_REPO) return process.env.GITHUB_REPO;
  // Vercel exposes the connected repository as system environment variables.
  const owner = process.env.VERCEL_GIT_REPO_OWNER;
  const slug = process.env.VERCEL_GIT_REPO_SLUG;
  return owner && slug ? `${owner}/${slug}` : null;
}

export function githubConfigured(): boolean {
  return Boolean(process.env.GITHUB_TOKEN && githubRepo());
}

async function gh(path: string, init: RequestInit = {}) {
  const repo = githubRepo();
  const token = process.env.GITHUB_TOKEN;
  if (!repo || !token) throw new Error("GitHub isn't set up yet: add GITHUB_TOKEN in Vercel.");
  const res = await fetch(`https://api.github.com/repos/${repo}${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init.headers ?? {}),
    },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    let message = body.slice(0, 160);
    try {
      message = JSON.parse(body).message ?? message;
    } catch {}
    throw new Error(`GitHub returned ${res.status}${message ? `: ${message}` : ""}`);
  }
  return res.status === 204 ? null : res.json();
}

export type Run = {
  id: number;
  status: "queued" | "in_progress" | "completed" | "waiting" | "requested" | "pending";
  conclusion: string | null;
  created_at: string;
  run_started_at: string | null;
  updated_at: string;
  html_url: string;
  event: string;
};

export type Step = { name: string; status: string; conclusion: string | null; started_at: string | null; completed_at: string | null };

export async function dispatchRun(): Promise<void> {
  await gh(`/actions/workflows/${WORKFLOW}/dispatches`, { method: "POST", body: JSON.stringify({ ref: "main" }) });
}

export async function recentRuns(count = 10): Promise<Run[]> {
  const data = await gh(`/actions/workflows/${WORKFLOW}/runs?per_page=${count}`);
  return (data?.workflow_runs ?? []) as Run[];
}

export async function runSteps(runId: number): Promise<Step[]> {
  const data = await gh(`/actions/runs/${runId}/jobs`);
  return ((data?.jobs ?? [])[0]?.steps ?? []) as Step[];
}
