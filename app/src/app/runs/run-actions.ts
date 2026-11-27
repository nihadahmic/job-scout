"use server";

import { dispatchRun, githubConfigured, recentRuns, runSteps, type Run } from "@/lib/github";
import { createClient } from "@/lib/supabase/server";

type Result<T> = ({ ok: true } & T) | { ok: false; error: string };

// Steps worth showing; the rest (checkout, set up job...) are plumbing.
const SHOWN_STEPS = ["Check secrets", "Install", "Test", "Collect", "Screen"];

export type RunStatus = {
  configured: boolean;
  active: boolean;
  run: { id: number; status: Run["status"]; conclusion: string | null; url: string; startedAt: string | null; finishedAt: string | null } | null;
  steps: { name: string; state: "done" | "running" | "waiting" | "failed" | "skipped" }[];
  elapsedSeconds: number;
  typicalSeconds: number | null;
  remainingSeconds: number | null;
};

async function ownerOnly(): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("is_owner");
  return data === true ? null : "Only the owner can start runs.";
}

function seconds(from: string | null, to: string | number): number {
  if (!from) return 0;
  return Math.max(0, Math.round((new Date(to).getTime() - new Date(from).getTime()) / 1000));
}

export async function startRun(): Promise<Result<object>> {
  const denied = await ownerOnly();
  if (denied) return { ok: false, error: denied };
  if (!githubConfigured()) return { ok: false, error: "GitHub isn't set up yet: add GITHUB_TOKEN in Vercel." };
  try {
    const runs = await recentRuns(5);
    if (runs.some((r) => r.status !== "completed")) return { ok: false, error: "A run is already going." };
    await dispatchRun();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't start the run." };
  }
}

export async function getRunStatus(): Promise<Result<{ status: RunStatus }>> {
  const denied = await ownerOnly();
  if (denied) return { ok: false, error: denied };
  if (!githubConfigured()) {
    return {
      ok: true,
      status: { configured: false, active: false, run: null, steps: [], elapsedSeconds: 0, typicalSeconds: null, remainingSeconds: null },
    };
  }
  try {
    // A fallback schedule run that found today already covered finishes in seconds; hide it.
    const runs = (await recentRuns(15)).filter(
      (r) => !(r.event === "schedule" && r.status === "completed" && seconds(r.run_started_at ?? r.created_at, r.updated_at) < 90),
    );
    const latest = runs[0] ?? null;
    // Typical duration: median of recent successful runs.
    const durations = runs
      .filter((r) => r.status === "completed" && r.conclusion === "success" && r.run_started_at)
      .slice(0, 7)
      .map((r) => seconds(r.run_started_at, r.updated_at))
      .sort((a, b) => a - b);
    const typical = durations.length ? durations[Math.floor(durations.length / 2)] : null;

    if (!latest) {
      return {
        ok: true,
        status: { configured: true, active: false, run: null, steps: [], elapsedSeconds: 0, typicalSeconds: typical, remainingSeconds: null },
      };
    }
    const active = latest.status !== "completed";
    const steps = (await runSteps(latest.id))
      .filter((s) => SHOWN_STEPS.includes(s.name))
      .map((s) => ({
        name: s.name,
        state: (s.status === "completed"
          ? s.conclusion === "success"
            ? "done"
            : s.conclusion === "skipped"
              ? "skipped"
              : "failed"
          : s.status === "in_progress"
            ? "running"
            : "waiting") as RunStatus["steps"][number]["state"],
      }));
    const startedAt = latest.run_started_at ?? latest.created_at;
    const elapsed = active ? seconds(startedAt, Date.now()) : seconds(startedAt, latest.updated_at);
    return {
      ok: true,
      status: {
        configured: true,
        active,
        run: {
          id: latest.id,
          status: latest.status,
          conclusion: latest.conclusion,
          url: latest.html_url,
          startedAt,
          finishedAt: active ? null : latest.updated_at,
        },
        steps,
        elapsedSeconds: elapsed,
        typicalSeconds: typical,
        remainingSeconds: active && typical != null ? Math.max(0, typical - elapsed) : null,
      },
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't read the run." };
  }
}
