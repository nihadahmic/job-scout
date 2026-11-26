/** Minimal Gemini client for server code. The key comes from GEMINI_API_KEY (server-only). */

const DEFAULT_MODEL = "gemini-3.6-flash";
const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

export class GeminiError extends Error {}

export function geminiConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY);
}

export async function generateJson<T>(opts: {
  system: string;
  prompt: string;
  schema: Record<string, unknown>;
  temperature?: number;
}): Promise<T> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new GeminiError("Gemini isn't set up yet: add GEMINI_API_KEY in Vercel.");
  const model = process.env.GEMINI_MODEL || DEFAULT_MODEL;
  const res = await fetch(`${ENDPOINT}/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: opts.system }] },
      contents: [{ role: "user", parts: [{ text: opts.prompt }] }],
      generationConfig: {
        temperature: opts.temperature ?? 0.7,
        responseMimeType: "application/json",
        responseSchema: opts.schema,
      },
    }),
    signal: AbortSignal.timeout(90_000),
    cache: "no-store",
  });
  if (res.status === 429) {
    throw new GeminiError("Gemini's free-tier limit is used up for now. Try again in a minute, or tomorrow.");
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    const message = (() => {
      try {
        return JSON.parse(detail).error?.message as string;
      } catch {
        return detail.slice(0, 200);
      }
    })();
    throw new GeminiError(`Gemini returned ${res.status}${message ? `: ${message}` : ""}`);
  }
  const data = await res.json();
  const text: string | undefined = data?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? "").join("");
  if (!text) {
    const reason = data?.candidates?.[0]?.finishReason ?? data?.promptFeedback?.blockReason ?? "no text";
    throw new GeminiError(`Gemini returned no draft (${reason}).`);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new GeminiError("Gemini's reply wasn't valid JSON. Try again.");
  }
}
