/**
 * Answers factual application questions from the profile, without any AI model.
 * Self-contained so it can be tested with node --test.
 */

export type FactsInput = {
  location: string;
  notice_period: string;
  available_from: string;
  work_authorization: string;
  needs_sponsorship: "" | "no" | "yes";
  languages: string;
  linkedin: string;
  portfolio: string;
  github: string;
  other_links: string;
};

export type FactAnswer =
  | { kind: "fact"; field: string; answer: string }
  | { kind: "missing"; field: string; answer: "" }
  | { kind: "yourself"; field: string; answer: "" }
  | { kind: "salary" };

const RULES: [RegExp, keyof FactsInput | "salary" | "identity"][] = [
  [/\b(first|last|full|legal|preferred)\s+name\b|\b(e-?mail|phone|mobile|telephone)\b|^name\??$/i, "identity"],
  [/\b(sponsor\w*|visa)\b/i, "needs_sponsorship"],
  [/\b(authori[sz]\w*|right to work|eligible to work|legally (able|allowed)|work permit)\b/i, "work_authorization"],
  [/\bnotice\b/i, "notice_period"],
  [/\b(start(ing)? date|earliest start|when (can|could|would) you (start|join)|availability|available to start)\b/i, "available_from"],
  [/\b(salary|compensation|pay expectations?|expected (pay|rate)|hourly rate|rate expectations?|remuneration)\b/i, "salary"],
  [/\blinked\s?in\b/i, "linkedin"],
  [/\bgit\s?hub\b/i, "github"],
  [/\b(portfolio|personal (web)?site|website)\b/i, "portfolio"],
  [/\b(where are you (based|located)|current location|country of residence|city|located in|which country)\b/i, "location"],
  [/\b(languages?|fluen\w*|proficien\w*)\b/i, "languages"],
];

export function answerFact(question: string, facts: FactsInput): FactAnswer | null {
  for (const [re, field] of RULES) {
    if (!re.test(question)) continue;
    if (field === "identity") return { kind: "yourself", field, answer: "" };
    if (field === "salary") return { kind: "salary" };
    if (field === "needs_sponsorship") {
      if (!facts.needs_sponsorship) return { kind: "missing", field, answer: "" };
      return { kind: "fact", field, answer: facts.needs_sponsorship === "no" ? "No" : "Yes" };
    }
    const value = facts[field].trim();
    return value ? { kind: "fact", field, answer: value } : { kind: "missing", field, answer: "" };
  }
  return null;
}
