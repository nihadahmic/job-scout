/** Fetch a posting's application questions from the ATS, where the ATS publishes them. */

export type PostingQuestions = { questions: string[]; from: string } | { error: string };

const SKIP_FIELD_TYPES = new Set(["input_file"]);

export async function loadPostingQuestions(job: { source: string; source_id: string }): Promise<PostingQuestions> {
  const [slug, id] = job.source_id.split("/");
  try {
    if (job.source === "greenhouse" && slug && id) {
      const res = await fetch(
        `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(slug)}/jobs/${encodeURIComponent(id)}?questions=true`,
        { cache: "no-store", signal: AbortSignal.timeout(20_000) },
      );
      if (!res.ok) return { error: `Greenhouse returned ${res.status}; the posting may be closed.` };
      const data = await res.json();
      const all = [...(data.questions ?? []), ...(data.location_questions ?? [])] as {
        label?: string;
        fields?: { type?: string }[];
      }[];
      const questions = all
        .filter((q) => q.label && !(q.fields ?? []).every((f) => SKIP_FIELD_TYPES.has(f.type ?? "")))
        .map((q) => q.label!.trim());
      return { questions, from: "Greenhouse" };
    }
    if (job.source === "recruitee" && slug && id) {
      const res = await fetch(`https://${encodeURIComponent(slug)}.recruitee.com/api/offers/`, {
        cache: "no-store",
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) return { error: `Recruitee returned ${res.status}.` };
      const offer = ((await res.json()).offers ?? []).find((o: { id: number }) => String(o.id) === id);
      if (!offer) return { error: "The posting is no longer listed on Recruitee." };
      const questions = (offer.open_questions ?? [])
        .map((q: { body?: string }) => (q.body ?? "").replace(/<[^>]+>/g, "").trim())
        .filter(Boolean);
      return { questions, from: "Recruitee" };
    }
  } catch (e) {
    return { error: `Couldn't fetch the questions (${e instanceof Error ? e.message : "network error"}).` };
  }
  return { error: "This source doesn't publish its application questions. Paste them below instead." };
}
