import { NextResponse, type NextRequest } from "next/server";
import { dispatchRun, githubConfigured, ranToday, recentRuns } from "@/lib/github";

/**
 * Daily trigger for the collect workflow, called by Vercel Cron (see vercel.json).
 * GitHub's own schedule is best-effort and often hours late or skipped, so this is the main
 * trigger and the workflow's schedule is the fallback. Either one skips if a run already
 * happened today (UTC), so a day never gets two runs.
 */
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  // No secret configured means the endpoint is closed, not open.
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!githubConfigured()) {
    return NextResponse.json({ error: "GITHUB_TOKEN is not set" }, { status: 500 });
  }
  try {
    if (ranToday(await recentRuns(10))) return NextResponse.json({ started: false, reason: "already ran today" });
    await dispatchRun();
    return NextResponse.json({ started: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "failed" }, { status: 502 });
  }
}
