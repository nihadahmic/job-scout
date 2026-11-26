/** Minimal Gemini client for server code. The key comes from GEMINI_API_KEY (server-only). */

// Flash-Lite is the default: on the free tier (Nov 2026) the full Flash models were often
// overloaded (503) or took over a minute, while Flash-Lite answered in about 2 seconds.
// GEMINI_MODEL can name another model; it is tried first, then Flash-Lite.
const FALLBACK_MODEL = "gemini-3.5-flash-lite";
const PREFERRED_TIMEOUT_MS = 25_000;
const FALLBACK_TIMEOUT_MS = 30_000;
const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

export class GeminiError extends Error {}

export function geminiConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY);
}

type Request = { system: string; prompt: string; schema: Record<string, unknown>; temperature?: number };

export async function generateJson<T>(opts: Request): Promise<T> {
  return (await generateJsonWithModel<T>(opts)).data;
}

/** Like generateJson, and also says which model answered. */
export async function generateJsonWithModel<T>(opts: Request): Promise<{ data: T; model: string }> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new GeminiError("Gemini isn't set up yet: add GEMINI_API_KEY in Vercel.");
  const preferred = process.env.GEMINI_MODEL?.trim();
  const models = preferred && preferred !== FALLBACK_MODEL ? [preferred, FALLBACK_MODEL] : [FALLBACK_MODEL];
  let lastError: GeminiError | null = null;
  for (const [i, model] of models.entries()) {
    const last = i === models.length - 1;
    try {
      const data = await callModel<T>(key, model, opts, last ? FALLBACK_TIMEOUT_MS : PREFERRED_TIMEOUT_MS);
      return { data, model };
    } catch (e) {
      lastError = e instanceof GeminiError ? e : new GeminiError("Gemini didn't answer in time. Try again.");
      // Busy, rate-limited or slow: try the next model. Anything else won't improve.
      if (!(lastError instanceof RetryableError) && !(e instanceof DOMException)) throw lastError;
    }
  }
  throw lastError ?? new GeminiError("Gemini didn't answer. Try again.");
}

class RetryableError extends GeminiError {}

async function callModel<T>(key: string, model: string, opts: Request, timeoutMs: number): Promise<T> {
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
    signal: AbortSignal.timeout(timeoutMs),
    cache: "no-store",
  });
  if (res.status === 429) {
    throw new RetryableError("Gemini's free-tier limit is used up for now. Try again in a minute, or tomorrow.");
  }
  if (res.status === 503 || res.status === 500) {
    throw new RetryableError("Gemini is busy right now. Try again in a minute.");
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    let message = detail.slice(0, 200);
    try {
      message = JSON.parse(detail).error?.message ?? message;
    } catch {}
    throw new GeminiError(`Gemini returned ${res.status}${message ? `: ${message}` : ""}`);
  }
  const data = await res.json();
  const text: string | undefined = data?.candidates?.[0]?.content?.parts
    ?.map((p: { text?: string }) => p.text ?? "")
    .join("");
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
