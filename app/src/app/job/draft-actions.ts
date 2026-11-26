"use server";

import { revalidatePath } from "next/cache";
import { extractText, getDocumentProxy } from "unpdf";
import { checkLetter } from "@/lib/drafting/checks";
import { answerFact } from "@/lib/drafting/facts";
import { GeminiError, generateJson, generateJsonWithModel } from "@/lib/drafting/gemini";
import { loadPostingQuestions } from "@/lib/drafting/questions";
import { removeContactDetails } from "@/lib/drafting/redact";
import { suggestSalary } from "@/lib/drafting/salary";
import { withDefaults } from "@/lib/profile";
import { createClient } from "@/lib/supabase/server";

const MAX_POSTING_CHARS = 12_000;

export type LetterDraft = {
  id: number;
  created_at: string;
  kind: "draft" | "revision" | "edit" | "restore";
  body: string;
  notes: string | null;
  model: string | null;
  problems: string[];
};

/** The letter without the app's sign-off, which Gemini never writes. */
function letterBody(letter: string): string {
  return letter.replace(/\n\s*\nBest,\n[^\n]*\s*$/, "").trim();
}

async function recordDraft(
  jobId: string,
  draft: Omit<LetterDraft, "id" | "created_at">,
): Promise<LetterDraft | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("letter_drafts")
    .insert({ job_id: jobId, ...draft })
    .select("id, created_at, kind, body, notes, model, problems")
    .single();
  return (data as LetterDraft) ?? null;
}

export type Answer = {
  question: string;
  answer: string;
  source: "profile" | "salary" | "gemini" | "yourself" | "missing";
  note?: string;
};

type Ok<T> = { ok: true } & T;
type Fail = { ok: false; error: string };

async function context(jobId: string) {
  const supabase = await createClient();
  const [{ data: job }, { data: profileRow }] = await Promise.all([
    supabase
      .from("jobs")
      .select(
        "id, title, company, description, source, source_id, salary_min_eur_month, salary_max_eur_month, cover_letter",
      )
      .eq("id", jobId)
      .maybeSingle(),
    supabase.from("profile").select("*").maybeSingle(),
  ]);
  if (!job) throw new GeminiError("Job not found.");
  return { supabase, job, profile: withDefaults(profileRow) };
}

/** Current CV as text with contact details removed, if the owner allows it. */
async function cvText(ctx: Awaited<ReturnType<typeof context>>): Promise<string> {
  const { profile, supabase } = ctx;
  if (!profile.preferences.ai.allow_cv || !profile.current_cv) return "";
  const { data, error } = await supabase.storage.from("cv").download(profile.current_cv);
  if (error || !data) return "";
  const pdf = await getDocumentProxy(new Uint8Array(await data.arrayBuffer()));
  const { text } = await extractText(pdf, { mergePages: true });
  return removeContactDetails(text, profile.facts.full_name).text.slice(0, 8_000);
}

function material(ctx: Awaited<ReturnType<typeof context>>, cv: string): string {
  const { job, profile } = ctx;
  return [
    `JOB: ${job.title} at ${job.company}`,
    `POSTING:\n${(job.description || "(no description from this source)").slice(0, MAX_POSTING_CHARS)}`,
    `MY EXPERIENCE (my own summary; follow its accuracy notes):\n${profile.experience || "(empty)"}`,
    cv ? `MY CV (contact details removed):\n${cv}` : "",
  ]
    .filter(Boolean)
    .join("\n\n---\n\n");
}

const SYSTEM = `You draft job application text for a senior product manager, in his voice: first person, plain, direct.
Use only facts that appear in his experience or CV. Never invent employers, products, numbers, tools or results.
Keep "owned" vs "contributed" exactly as his material says, and keep approximate numbers approximate.
Use real details from the posting to show why this company; do not mirror the posting's wording.
Never use em dashes or en dashes.`;

async function save(jobId: string, patch: Record<string, unknown>) {
  const supabase = await createClient();
  const { error } = await supabase.from("jobs").update(patch).eq("id", jobId);
  if (error) throw new GeminiError(error.message);
  revalidatePath("/job");
}

export async function draftCoverLetter(
  jobId: string,
  notes = "",
): Promise<Ok<{ letter: string; problems: string[]; draft: LetterDraft | null }> | Fail> {
  try {
    const ctx = await context(jobId);
    const cv = await cvText(ctx);
    const rules = ctx.profile.writing_rules || "Cover letter, 170 to 230 words. Plain, direct, no platitudes.";
    const wishes = notes.trim().slice(0, 2_000);
    const current = ctx.job.cover_letter ? letterBody(ctx.job.cover_letter) : "";
    const revising = Boolean(wishes && current);
    const task = revising
      ? `CURRENT LETTER:\n${current}\n\nMY NOTES FOR THIS REVISION:\n${wishes}\n\nRevise the current letter following my notes. Keep what the notes don't ask to change. My writing rules and the facts in my material still win over the notes: never invent anything to satisfy a note.`
      : `${wishes ? `MY NOTES FOR THIS DRAFT (follow them; the writing rules and my facts still win):\n${wishes}\n\n` : ""}Write the cover letter for this job.`;
    const prompt = `${material(ctx, cv)}\n\n---\n\nMY WRITING RULES (follow exactly):\n${rules}\n\n${task} Start straight with the first paragraph: no "Dear..." line, no date, no address. End without a sign-off or name; the app adds those. Separate paragraphs with a blank line.`;
    const schema = { type: "OBJECT", properties: { letter: { type: "STRING" } }, required: ["letter"] };

    let { data, model } = await generateJsonWithModel<{ letter: string }>({ system: SYSTEM, prompt, schema });
    let letter = data.letter;
    let problems = checkLetter(letter);
    if (problems.length) {
      ({ data, model } = await generateJsonWithModel<{ letter: string }>({
        system: SYSTEM,
        prompt: `${prompt}\n\nYOUR PREVIOUS DRAFT:\n${letter}\n\nIt broke these rules: ${problems.join("; ")}. Rewrite it so it follows every rule.`,
        schema,
      }));
      letter = data.letter;
      problems = checkLetter(letter);
    }
    const name = ctx.profile.facts.full_name.trim();
    const full = `${letter.trim()}\n\nBest,\n${name || "[your name]"}`;
    await save(jobId, { cover_letter: full });
    const draft = await recordDraft(jobId, {
      kind: revising ? "revision" : "draft",
      body: full,
      notes: wishes || null,
      model,
      problems,
    });
    return { ok: true, letter: full, problems, draft };
  } catch (e) {
    return { ok: false, error: e instanceof GeminiError ? e.message : "Drafting failed. Try again." };
  }
}

export async function saveCoverLetter(jobId: string, letter: string): Promise<Ok<{ draft: LetterDraft | null }> | Fail> {
  try {
    const body = letter.slice(0, 20_000);
    await save(jobId, { cover_letter: body });
    const draft = await recordDraft(jobId, {
      kind: "edit",
      body,
      notes: null,
      model: null,
      problems: checkLetter(letterBody(body)),
    });
    return { ok: true, draft };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't save." };
  }
}

export async function restoreDraft(jobId: string, draftId: number): Promise<Ok<{ letter: string; draft: LetterDraft | null }> | Fail> {
  try {
    const supabase = await createClient();
    const { data: old } = await supabase
      .from("letter_drafts")
      .select("body, problems")
      .eq("id", draftId)
      .eq("job_id", jobId)
      .maybeSingle();
    if (!old) return { ok: false, error: "That version no longer exists." };
    await save(jobId, { cover_letter: old.body });
    const draft = await recordDraft(jobId, {
      kind: "restore",
      body: old.body,
      notes: `Restored version #${draftId}`,
      model: null,
      problems: old.problems ?? [],
    });
    return { ok: true, letter: old.body, draft };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't restore." };
  }
}

export async function fetchPostingQuestions(jobId: string): Promise<Ok<{ questions: string[]; from: string }> | Fail> {
  const supabase = await createClient();
  const { data: job } = await supabase.from("jobs").select("source, source_id").eq("id", jobId).maybeSingle();
  if (!job) return { ok: false, error: "Job not found." };
  const result = await loadPostingQuestions(job);
  return "error" in result ? { ok: false, error: result.error } : { ok: true, ...result };
}

export async function draftAnswers(jobId: string, questions: string[]): Promise<Ok<{ answers: Answer[] }> | Fail> {
  try {
    const list = questions.map((q) => q.trim()).filter(Boolean).slice(0, 30);
    if (!list.length) return { ok: false, error: "Add at least one question." };
    const ctx = await context(jobId);
    const salary = suggestSalary(ctx.profile.preferences.salary, {
      min: ctx.job.salary_min_eur_month,
      max: ctx.job.salary_max_eur_month,
    });

    const answers: Answer[] = list.map((question) => {
      const fact = answerFact(question, ctx.profile.facts);
      if (!fact) return { question, answer: "", source: "gemini" };
      if (fact.kind === "salary")
        return salary.text
          ? { question, answer: salary.text, source: "salary", note: salary.basis }
          : { question, answer: "", source: "missing", note: salary.basis };
      if (fact.kind === "fact") return { question, answer: fact.answer, source: "profile" };
      if (fact.kind === "yourself") return { question, answer: "", source: "yourself", note: "Personal detail: fill this in yourself." };
      return { question, answer: "", source: "missing", note: "Add this under Profile → Application facts." };
    });

    const open = answers.map((a, i) => ({ a, i })).filter(({ a }) => a.source === "gemini");
    if (open.length) {
      const cv = await cvText(ctx);
      const numbered = open.map(({ a }, n) => `${n + 1}. ${a.question}`).join("\n");
      const result = await generateJson<{ answers: { number: number; answer: string }[] }>({
        system: SYSTEM,
        prompt: `${material(ctx, cv)}\n\n---\n\nMY WRITING RULES:\n${ctx.profile.writing_rules}\n\nAnswer these application questions for this job. 40 to 150 words each unless the question clearly wants less. Do not state salary, notice period, work authorization or visa status; those are answered separately.\n\n${numbered}`,
        schema: {
          type: "OBJECT",
          properties: {
            answers: {
              type: "ARRAY",
              items: {
                type: "OBJECT",
                properties: { number: { type: "INTEGER" }, answer: { type: "STRING" } },
                required: ["number", "answer"],
              },
            },
          },
          required: ["answers"],
        },
      });
      for (const r of result.answers ?? []) {
        const target = open[r.number - 1];
        if (target) answers[target.i].answer = r.answer.trim();
      }
    }
    await save(jobId, { answers });
    return { ok: true, answers };
  } catch (e) {
    return { ok: false, error: e instanceof GeminiError ? e.message : "Drafting failed. Try again." };
  }
}

export async function saveAnswers(jobId: string, answers: Answer[]): Promise<Ok<object> | Fail> {
  try {
    await save(jobId, { answers: answers.slice(0, 50) });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't save." };
  }
}

export async function saveSalaryAnswer(jobId: string, text: string): Promise<Ok<object> | Fail> {
  try {
    await save(jobId, { salary_answer: text.slice(0, 1_000) });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't save." };
  }
}
