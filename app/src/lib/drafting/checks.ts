/**
 * Checks a drafted cover letter against the writing rules the app can test.
 * Self-contained so it can be tested with node --test.
 */

export const LETTER_WORDS = { min: 170, max: 230 };

const BANNED: [RegExp, string][] = [
  [/—|–/, "Uses an em or en dash"],
  [/\bnot (just|only)\b[^.]*\bbut\b/i, 'Uses a "not just X but Y" pivot'],
  [/\brather than\b/i, 'Uses a "rather than" pivot'],
  [/\b(in conclusion|to sum up|all in all|in summary)\b/i, "Has a wrap-up line"],
  [/\b(passionate|thrilled|excited to apply|i am excited|dream job|perfect fit|great fit)\b/i, "Uses a platitude"],
  [/\b(synerg\w*|leverag\w*|cutting[- ]edge|fast[- ]paced|go[- ]getter|team player|results[- ]driven)\b/i, "Uses buzzwords"],
  [/\bI am writing to (express|apply)\b/i, "Opens with a stock line"],
  // "X, Y, and Z": a list of three (tricolon), items of one to three words.
  [/\b[\w'-]+(\s[\w'-]+){0,2},\s[\w'-]+(\s[\w'-]+){0,2},?\s(and|or)\s[\w'-]+/i, "Uses a list of three (tricolon)"],
  // "You are not X. The Y is..." / "You don't win by X. You win by Y.": a pivot across two sentences.
  [/\b(not|n't|never)\b[^.!?]{0,80}[.!?]\s+(but\s+)?(the|it|you|we|i|they|this)\b[^.!?]{0,40}\b(is|are|win|wins|do|does)\b/i, 'Uses a "not X. Y" pivot across sentences'],
];

export function wordCount(text: string): number {
  return (text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? []).length;
}

/** Paragraphs of near-equal length read as templated. */
function symmetrical(paragraphs: string[]): boolean {
  if (paragraphs.length < 3) return false;
  const lengths = paragraphs.map(wordCount);
  const avg = lengths.reduce((a, b) => a + b, 0) / lengths.length;
  return lengths.every((n) => Math.abs(n - avg) <= avg * 0.15);
}

export function checkLetter(body: string): string[] {
  const problems: string[] = [];
  const words = wordCount(body);
  if (words < LETTER_WORDS.min) problems.push(`Too short: ${words} words (aim for ${LETTER_WORDS.min} to ${LETTER_WORDS.max})`);
  if (words > LETTER_WORDS.max) problems.push(`Too long: ${words} words (aim for ${LETTER_WORDS.min} to ${LETTER_WORDS.max})`);
  for (const [re, message] of BANNED) if (re.test(body)) problems.push(message);
  const paragraphs = body.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  if (symmetrical(paragraphs)) problems.push("Paragraphs are all about the same length");
  return problems;
}
