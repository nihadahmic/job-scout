"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import {
  draftAnswers,
  draftCoverLetter,
  fetchPostingQuestions,
  saveAnswers,
  saveCoverLetter,
  saveSalaryAnswer,
  type Answer,
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

function CopyButton({ text }: { text: string }) {
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
      {done ? "Copied" : "Copy"}
    </button>
  );
}

function letterBody(letter: string): string {
  return letter.replace(/\n\s*\nBest,\n[^\n]*\s*$/, "");
}

export function DraftPanel({
  jobId,
  geminiReady,
  canLoadQuestions,
  salary,
  savedSalary,
  savedLetter,
  savedAnswers,
}: {
  jobId: string;
  geminiReady: boolean;
  canLoadQuestions: boolean;
  salary: Salary;
  savedSalary: string | null;
  savedLetter: string | null;
  savedAnswers: Answer[] | null;
}) {
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<"" | "letter" | "load" | "answers">("");
  const [error, setError] = useState("");

  const [salaryText, setSalaryText] = useState(savedSalary ?? "");
  const [letter, setLetter] = useState(savedLetter ?? "");
  const [letterSaved, setLetterSaved] = useState(savedLetter ?? "");
  const [questionsText, setQuestionsText] = useState((savedAnswers ?? []).map((a) => a.question).join("\n"));
  const [answers, setAnswers] = useState<Answer[]>(savedAnswers ?? []);
  const [answersDirty, setAnswersDirty] = useState(false);
  const [info, setInfo] = useState("");

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

  const problems = letter ? checkLetter(letterBody(letter)) : [];

  return (
    <section className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Application kit</h2>
        {!geminiReady && (
          <span className="text-xs text-amber-700 dark:text-amber-400">Gemini isn&apos;t set up yet (GEMINI_API_KEY in Vercel)</span>
        )}
      </div>
      {error && <p className="mb-3 rounded-md bg-rose-50 p-2 text-sm text-rose-800 dark:bg-rose-950 dark:text-rose-200">{error}</p>}

      {/* Salary */}
      <div className="mb-5">
        <h3 className="mb-1 text-sm font-medium">Salary</h3>
        {salary.text ? (
          <div className={`rounded-md p-3 text-sm ${salary.belowFloor ? "bg-amber-50 dark:bg-amber-950" : "bg-zinc-50 dark:bg-zinc-900"}`}>
            <p className="font-medium">{salary.text}</p>
            <p className="text-xs text-zinc-500">{salary.basis}</p>
            <div className="mt-2 flex items-center gap-2">
              <input value={salaryText} onChange={(e) => setSalaryText(e.target.value)} placeholder="What you'll ask for" className="field flex-1 py-1 text-sm" />
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
      </div>

      {/* Cover letter */}
      <div className="mb-5">
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-medium">Cover letter</h3>
          <div className="flex items-center gap-1">
            {letter && <CopyButton text={letter} />}
            <button
              type="button"
              className="btn text-xs"
              disabled={!geminiReady || pending}
              onClick={() => run("letter", async () => {
                const r = await draftCoverLetter(jobId);
                if (r.ok) {
                  setLetter(r.letter);
                  setLetterSaved(r.letter);
                } else setError(r.error);
              })}
            >
              {busy === "letter" ? "Drafting…" : letter ? "Redraft" : "Draft with Gemini"}
            </button>
          </div>
        </div>
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
                    setInfo("Letter saved");
                  } else setError(r.error);
                })}
              >
                {letter === letterSaved ? "Saved" : "Save edits"}
              </button>
            </div>
          </>
        ) : (
          <p className="text-sm text-zinc-500">Draft a letter from your experience, writing rules and this posting.</p>
        )}
      </div>

      {/* Questions */}
      <div>
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-medium">Application questions</h3>
          {canLoadQuestions && (
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
          )}
        </div>
        <textarea
          value={questionsText}
          onChange={(e) => setQuestionsText(e.target.value)}
          rows={4}
          placeholder="One question per line"
          className="field w-full text-sm"
        />
        <button
          type="button"
          className="btn mt-2 text-xs"
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
        {!geminiReady && <span className="ml-2 text-xs text-zinc-500">Factual answers work without Gemini.</span>}

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
        {answersDirty && (
          <button
            type="button"
            className="btn-ghost mt-2 text-xs"
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
      {info && <p className="mt-3 text-xs text-emerald-700 dark:text-emerald-400">{info}</p>}
    </section>
  );
}
