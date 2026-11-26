-- Drafting: the app may save the cover letter, application answers and salary note it
-- drafts for a job. Nothing else on jobs becomes writable from the app.
grant update (notes, cover_letter, answers, salary_answer) on public.jobs to authenticated;
