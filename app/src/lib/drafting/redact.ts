/**
 * Remove contact details from CV text before it is sent to Gemini: the name, email
 * addresses, phone numbers and web/profile links. Employer names and the rest stay.
 * Self-contained (no imports) so it can be tested with node --test.
 */

const EMAIL = /[\w.+-]+@[\w-]+(\.[\w-]+)+/g;
const PHONE = /(?:\+|00)\d[\d\s().-]{6,}\d|\b\d{3}[\s.-]\d{3}[\s.-]\d{3,4}\b/g;
const URL = /\bhttps?:\/\/\S+/gi;
const DOMAIN = /\b(?:www\.)?[\w-]+(?:\.[\w-]+)*\.(?:com|net|org|io|dev|me|ba|co|app|ai|eu|info|xyz)(?:\/[^\s,;)]*)?/gi;
const HANDLE = /\b(?:linkedin|github|x|twitter)\.com\/\S+/gi;

export type Redaction = { text: string; removed: number };

export function removeContactDetails(cvText: string, fullName?: string): Redaction {
  let removed = 0;
  const swap = (re: RegExp, label: string) => (s: string) =>
    s.replace(re, () => {
      removed++;
      return label;
    });

  let text = cvText;
  for (const step of [
    swap(EMAIL, "[email removed]"),
    swap(HANDLE, "[link removed]"),
    swap(URL, "[link removed]"),
    swap(DOMAIN, "[link removed]"),
    swap(PHONE, "[phone removed]"),
  ]) {
    text = step(text);
  }

  // The name: the profile's full name if given, plus the CV's first line (CVs open with it).
  const names = new Set<string>();
  if (fullName?.trim()) names.add(fullName.trim());
  const firstLine = cvText.split("\n").map((l) => l.trim()).find(Boolean);
  if (firstLine && firstLine.split(/\s+/).length <= 4 && !/[@\d]/.test(firstLine)) names.add(firstLine);
  for (const name of names) {
    for (const part of name.split(/\s+/).filter((p) => p.length > 1)) {
      const re = new RegExp(`\\b${part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi");
      text = text.replace(re, () => {
        removed++;
        return "[name]";
      });
    }
  }
  text = text.replace(/(\[name\]\s*){2,}/g, "[name] ");
  return { text, removed };
}
