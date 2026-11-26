import assert from "node:assert/strict";
import { test } from "node:test";
import { checkLetter, wordCount } from "../src/lib/drafting/checks.ts";
import { answerFact, type FactsInput } from "../src/lib/drafting/facts.ts";
import { removeContactDetails } from "../src/lib/drafting/redact.ts";
import { suggestSalary } from "../src/lib/drafting/salary.ts";

const CV = `JANE DOE
Product Manager & Builder
janedoe.com · github.com/janedoe · linkedin.com/in/jane-doe · jane.doe@example.com · +387 61 123 456
Product Manager with 5+ years at Acme Health. Jane led onboarding.`;

test("contact details are removed, employers stay", () => {
  const { text, removed } = removeContactDetails(CV, "Jane Doe");
  for (const gone of ["jane.doe@example.com", "+387 61 123 456", "janedoe.com", "linkedin.com/in", "github.com/janedoe", "JANE", "Jane"]) {
    assert.ok(!text.includes(gone), `still contains ${gone}`);
  }
  assert.ok(text.includes("Acme Health"));
  assert.ok(text.includes("Product Manager"));
  assert.ok(removed >= 6);
});

test("first line is treated as the name when no name is given", () => {
  assert.ok(!removeContactDetails(CV).text.includes("DOE"));
});

const sentence = "We shipped the onboarding flow and measured completion carefully over several weeks. ";
const letter = (n: number) => `${sentence.repeat(n)}\n\nShort close here.`;

test("word count and length limits", () => {
  assert.equal(wordCount("One two three-four, it's five."), 5);
  assert.match(checkLetter(letter(5)).join(), /Too short/);
  assert.match(checkLetter(letter(30)).join(), /Too long/);
  assert.equal(checkLetter(letter(14)).length, 0);
});

test("banned patterns are flagged", () => {
  const problems = checkLetter(`${letter(14)} I am passionate — and it is not just X but Y, rather than Z.`).join(" | ");
  for (const expected of ["dash", "not just", "rather than", "platitude"]) assert.match(problems, new RegExp(expected));
});

test("tricolons and two-sentence pivots are flagged", () => {
  const base = letter(14);
  assert.match(checkLetter(`${base} It comes down to discovery, measurement, and shipping.`).join(), /tricolon/);
  assert.match(checkLetter(`${base} You are not trying to build a wedge. The wedge is already there.`).join(), /pivot/);
  assert.doesNotMatch(checkLetter(`${base} I worked with product and design.`).join(), /tricolon/);
});

const prefs = { floor_eur_hour: 30, target_eur_hour: 50, employment_discount_pct: 20, hours_per_month: 160 };

test("salary from floor and target when the posting has no range", () => {
  const s = suggestSalary(prefs, { min: null, max: null });
  assert.equal(s.text, "EUR 4,800 to EUR 8,000 per month on B2B");
  assert.equal(s.belowFloor, false);
});

test("salary aims at the upper middle of a posted range", () => {
  const s = suggestSalary(prefs, { min: 5000, max: 7000 });
  assert.equal(s.monthly, 6300);
});

test("a posted range below the floor is flagged and never undercut", () => {
  const s = suggestSalary(prefs, { min: 2000, max: 3000 });
  assert.equal(s.belowFloor, true);
  assert.equal(s.monthly, 4800);
});

test("employment is lower by the profile's discount", () => {
  assert.equal(suggestSalary(prefs, { min: null, max: null }, true).text, "EUR 3,800 to EUR 6,400 gross per month (employment)");
});

test("no rates set means no suggestion", () => {
  const s = suggestSalary({ floor_eur_hour: null, target_eur_hour: null, employment_discount_pct: null, hours_per_month: 160 }, { min: null, max: null });
  assert.equal(s.text, "");
});

const facts: FactsInput = {
  location: "Sarajevo, Bosnia and Herzegovina",
  notice_period: "2 weeks",
  available_from: "",
  work_authorization: "Can work as a contractor from Bosnia",
  needs_sponsorship: "no",
  languages: "English (C2)",
  linkedin: "https://linkedin.com/in/x",
  portfolio: "",
  github: "",
  other_links: "",
};

test("factual questions are answered from the profile", () => {
  assert.deepEqual(answerFact("Will you now or in the future require visa sponsorship?", facts), { kind: "fact", field: "needs_sponsorship", answer: "No" });
  assert.equal((answerFact("What is your notice period?", facts) as { answer: string }).answer, "2 weeks");
  assert.equal((answerFact("LinkedIn Profile", facts) as { answer: string }).answer, "https://linkedin.com/in/x");
  assert.equal(answerFact("What are your salary expectations?", facts)?.kind, "salary");
  assert.equal(answerFact("Email", facts)?.kind, "yourself");
  assert.equal(answerFact("When could you start?", facts)?.kind, "missing");
  assert.equal(answerFact("Why do you want to work at Acme?", facts), null);
});
