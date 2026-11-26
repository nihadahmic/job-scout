"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import {
  draftAnswers,
  draftCoverLetter,
  fetchPostingQuestions,
  restoreDraft,
  saveAnswers,
  saveCoverLetter,
  saveSalaryAnswer,
  type Answer,
  type LetterDraft,
} from "@/app/job/draft-actions";
import { checkLetter, wordCount } from "@/lib/drafting/checks";

type Salary = { text: string; basis: string; belowFloor: boolean };

const SOURCE_TAG: Record<Answer["source"], { label: string; className: string }> = {
  profile: { label: "From your profile", className: "bg-teal-50 text-teal-800 dark:bg-teal-950 dark:text-teal-300" },
  salary: { label: "Salary rules", className: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300" },
  gemini: { label: "Drafted by Gemini", className: "bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300" },
  yourself: { label: "Fill in yourself", className: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300" },
  missing: { label: "Missing in profile", className: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300" },
};

const KIND_LABEL: Record<LetterDraft["kind"], string> = {
  draft: "Gemini draft",
  revision: "Gemini revision",
  edit: "Your edit",
  restore: "Restored",
};

function Card({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        {right}
      </div>
      {children}
    </section>
  );
}

function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="btn-ghost text-xs"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
    >
      {done ? "Copied" : label}
    </button>
  );
}

function letterBody(letter: string): string {
  return letter.replace(/\n\s*\nBest,\n[^\n]*\s*$/, "");
}

function when(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Sarajevo",
  });
}

export function DraftPanel({
  jobId,
  geminiReady,
  canLoadQuestions,
  salary,
  savedSalary,
  savedLetter,
  savedAnswers,
  drafts: initialDrafts,
}: {
  jobId: string;
  geminiReady: boolean;
  canLoadQuestions: boolean;
  salary: Salary;
  savedSalary: string | null;
  savedLetter: string | null;
  savedAnswers: Answer[] | null;
  drafts: LetterDraft[];
}) {
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<"" | "letter" | "load" | "answers">("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  const [salaryText, setSalaryText] = useState(savedSalary ?? "");
  const [letter, setLetter] = useState(savedLetter ?? "");
  const [letterSaved, setLetterSaved] = useState(savedLetter ?? "");
  const [notes, setNotes] = useState("");
  const [drafts, setDrafts] = useState(initialDrafts);
  const [viewing, setViewing] = useState<number | null>(null);
  const [questionsText, setQuestionsText] = useState((savedAnswers ?? []).map((a) => a.question).join("\n"));
  const [answers, setAnswers] = useState<Answer[]>(savedAnswers ?? []);
  const [answersDirty, setAnswersDirty] = useState(false);

  const run = (kind: typeof busy, fn: () => Promise<void>) => {
    setError("");
    setInfo("");
    setBusy(kind);
    start(async () => {
      try {
        await fn();
      } finally {
        setBusy("");
      }
    });
  };
  const addDraft = (d: LetterDraft | null) => d && setDrafts((ds) => [d, ...ds]);

  const problems = letter ? checkLetter(letterBody(letter)) : [];
  const revising = Boolean(letter && notes.trim());

  return (
    <div className="flex flex-col gap-4">
      {!geminiReady && (
        <p className="rounded-md bg-amber-50 p-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
          Gemini isn&apos;t set up yet (GEMINI_API_KEY in Vercel). Salary and factual answers still work.
        </p>
      )}
      {error && <p className="rounded-md bg-rose-50 p-2 text-sm text-rose-800 dark:bg-rose-950 dark:text-rose-200">{error}</p>}
      {info && <p className="text-xs text-emerald-700 dark:text-emerald-400">{info}</p>}

      <Card title="Salary">
        {salary.text ? (
          <div className={`rounded-md p-3 text-sm ${salary.belowFloor ? "bg-amber-50 dark:bg-amber-950" : "bg-zinc-50 dark:bg-zinc-900"}`}>
            <p className="font-medium">{salary.text}</p>
            <p className="text-xs text-zinc-500">{salary.basis}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <input value={salaryText} onChange={(e) => setSalaryText(e.target.value)} placeholder="What you'll ask for" className="field min-w-0 flex-1 py-1 text-sm" />
              <button type="button" className="btn-ghost text-xs" onClick={() => setSalaryText(salary.text)}>Use this</button>
              <button
                type="button"
                className="btn text-xs"
                disabled={pending || salaryText === (savedSalary ?? "")}
                onClick={() => run("", async () => {
                  const r = await saveSalaryAnswer(jobId, salaryText);
                  r.ok ? setInfo("Salary saved") : setError(r.error);
                })}
              >
                Save
              </button>
            </div>
          </div>
        ) : (
          <p className="text-sm text-zinc-500">
            {salary.basis} <Link href="/profile" className="underline">Open profile</Link>
          </p>
        )}
      </Card>

      <Card
        title="Cover letter"
        right={
          letter ? (
            <span className="flex items-center gap-1">
              <CopyButton text={letter} />
            </span>
          ) : null
        }
      >
        {letter ? (
          <>
            <textarea value={letter} onChange={(e) => setLetter(e.target.value)} rows={14} className="field w-full text-sm leading-relaxed" />
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
              <span className="text-zinc-500">{wordCount(letterBody(letter))} words</span>
              {problems.length === 0 ? (
                <span className="text-emerald-700 dark:text-emerald-400">Follows the checkable rules</span>
              ) : (
                problems.map((p) => (
                  <span key={p} className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-800 dark:bg-amber-950 dark:text-amber-300">{p}</span>
                ))
              )}
              <button
                type="button"
                className="btn-ghost ml-auto text-xs"
                disabled={pending || letter === letterSaved}
                onClick={() => run("", async () => {
                  const r = await saveCoverLetter(jobId, letter);
                  if (r.ok) {
                    setLetterSaved(letter);
                    addDraft(r.draft);
                    setInfo("Letter saved");
                  } else setError(r.error);
                })}
              >
                {letter === letterSaved ? "Saved" : "Save edits"}
              </button>
            </div>
          </>
        ) : (
          <p className="mb-2 text-sm text-zinc-500">Draft a letter from your experience, writing rules and this posting.</p>
        )}

        <div className="mt-3 rounded-lg bg-zinc-50 p-3 dark:bg-zinc-900">
          <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400" htmlFor="gemini-notes">
            Notes for Gemini (optional)
          </label>
          <textarea
            id="gemini-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder="Shorter. Lead with the API integrations work. Mention their AI agent launch."
            className="field mt-1 w-full text-sm"
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="btn text-xs"
              disabled={!geminiReady || pending || (letter !== letterSaved)}
              title={letter !== letterSaved ? "Save or undo your edits first" : undefined}
              onClick={() => run("letter", async () => {
                const r = await draftCoverLetter(jobId, notes);
                if (r.ok) {
                  setLetter(r.letter);
                  setLetterSaved(r.letter);
                  addDraft(r.draft);
                  setNotes("");
                } else setError(r.error);
              })}
            >
              {busy === "letter" ? "Writing…" : revising ? "Revise with notes" : letter ? "Redraft from scratch" : "Draft with Gemini"}
            </button>
            <span className="text-xs text-zinc-500">
              {revising
                ? "Gemini edits the current letter following your notes."
                : letter
                  ? "Add notes to revise this letter instead of starting over."
                  : "Notes, if any, guide the first draft."}
            </span>
          </div>
        </div>

        {drafts.length > 0 && (
          <details className="mt-3">
            <summary className="cursor-pointer text-xs font-medium text-zinc-600 dark:text-zinc-400">
              History · {drafts.length} {drafts.length === 1 ? "version" : "versions"}
            </summary>
            <ol className="mt-2 flex flex-col divide-y divide-zinc-100 text-sm dark:divide-zinc-800">
              {drafts.map((d, i) => (
                <li key={d.id} className="py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs tabular-nums text-zinc-500">#{drafts.length - i}</span>
                    <span className="font-medium">{KIND_LABEL[d.kind]}</span>
                    <span className="text-xs text-zinc-500">
                      {when(d.created_at)} · {wordCount(letterBody(d.body))} words
                      {d.model ? ` · ${d.model}` : ""}
                      {d.problems?.length ? ` · ${d.problems.length} rule ${d.problems.length === 1 ? "issue" : "issues"}` : ""}
                    </span>
                    {i === 0 && d.body === letter && (
                      <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[11px] text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">Current</span>
                    )}
                    <span className="ml-auto flex gap-1">
                      <button type="button" className="btn-ghost text-xs" onClick={() => setViewing(viewing === d.id ? null : d.id)}>
                        {viewing === d.id ? "Hide" : "View"}
                      </button>
                      {d.body !== letter && (
                        <button
                          type="button"
                          className="btn-ghost text-xs"
                          disabled={pending}
                          onClick={() => run("", async () => {
                            const r = await restoreDraft(jobId, d.id);
                            if (r.ok) {
                              setLetter(r.letter);
                              setLetterSaved(r.letter);
                              addDraft(r.draft);
                              setInfo("Version restored");
                            } else setError(r.error);
                          })}
                        >
                          Restore
                        </button>
                      )}
                    </span>
                  </div>
                  {d.notes && <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">Notes: {d.notes}</p>}
                  {viewing === d.id && (
                    <pre className="mt-2 whitespace-pre-wrap rounded-md bg-zinc-50 p-3 font-sans text-sm leading-relaxed dark:bg-zinc-900">{d.body}</pre>
                  )}
                </li>
              ))}
            </ol>
          </details>
        )}
      </Card>

      <Card
        title="Application questions"
        right={
          canLoadQuestions ? (
            <button
              type="button"
              className="btn-ghost text-xs"
              disabled={pending}
              onClick={() => run("load", async () => {
                const r = await fetchPostingQuestions(jobId);
                if (r.ok) {
                  setQuestionsText(r.questions.join("\n"));
                  setInfo(r.questions.length ? `${r.questions.length} questions loaded from ${r.from}` : `${r.from} lists no questions for this posting`);
                } else setError(r.error);
              })}
            >
              {busy === "load" ? "Loading…" : "Load from posting"}
            </button>
          ) : null
        }
      >
        <textarea value={questionsText} onChange={(e) => setQuestionsText(e.target.value)} rows={4} placeholder="One question per line" className="field w-full text-sm" />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="btn text-xs"
            disabled={pending || !questionsText.trim()}
            onClick={() => run("answers", async () => {
              const r = await draftAnswers(jobId, questionsText.split("\n"));
              if (r.ok) {
                setAnswers(r.answers);
                setAnswersDirty(false);
              } else setError(r.error);
            })}
          >
            {busy === "answers" ? "Drafting…" : "Draft answers"}
          </button>
          {!geminiReady && <span className="text-xs text-zinc-500">Factual answers work without Gemini.</span>}
          {answersDirty && (
            <button
              type="button"
              className="btn-ghost text-xs"
              disabled={pending}
              onClick={() => run("", async () => {
                const r = await saveAnswers(jobId, answers);
                if (r.ok) {
                  setAnswersDirty(false);
                  setInfo("Answers saved");
                } else setError(r.error);
              })}
            >
              Save edits
            </button>
          )}
        </div>
        {answers.length > 0 && (
          <ol className="mt-4 flex flex-col gap-4">
            {answers.map((a, i) => (
              <li key={i} className="text-sm">
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <span className="font-medium">{a.question}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[11px] ${SOURCE_TAG[a.source].className}`}>{SOURCE_TAG[a.source].label}</span>
                  {a.answer && <CopyButton text={a.answer} />}
                </div>
                {a.note && <p className="mb-1 text-xs text-zinc-500">{a.note}</p>}
                <textarea
                  value={a.answer}
                  onChange={(e) => {
                    const next = [...answers];
                    next[i] = { ...a, answer: e.target.value };
                    setAnswers(next);
                    setAnswersDirty(true);
                  }}
                  rows={a.answer.length > 200 ? 6 : 2}
                  className="field w-full text-sm"
                />
              </li>
            ))}
          </ol>
        )}
      </Card>
    </div>
  );
}
