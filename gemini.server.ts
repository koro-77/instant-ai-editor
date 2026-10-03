// Helper for calling Google's Gemini API directly (server-side only).
// The key comes from the GEMINI_API_KEY secret and never reaches the browser.

const BASE = "https://generativelanguage.googleapis.com/v1beta";

// "gemini-flash-latest" always points at Google's newest Flash model.
// Override with the GEMINI_MODEL / GEMINI_IMAGE_MODEL secrets if you want a specific one.
export const textModel = () => process.env["GEMINI_MODEL"] || "gemini-flash-latest";
export const imageModel = () => process.env["GEMINI_IMAGE_MODEL"] || "gemini-2.5-flash-image";

export type Part = { text: string } | { inlineData: { mimeType: string; data: string } };

// Turns "data:image/png;base64,AAAA" into a Gemini image part.
export function dataUrlToPart(url: string): Part {
  const m = url.match(/^data:([^;,]+);base64,(.*)$/s);
  if (!m) throw new Error("Bad image data");
  return { inlineData: { mimeType: m[1]!, data: m[2]! } };
}

export function geminiFetch(
  model: string,
  method: "generateContent" | "streamGenerateContent",
  apiKey: string,
  body: unknown,
  signal?: AbortSignal,
) {
  const url = `${BASE}/models/${model}:${method}${method === "streamGenerateContent" ? "?alt=sse" : ""}`;
  return fetch(url, {
    method: "POST",
    headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: signal ?? null,
  });
}

export function errorMessage(status: number, fallback: string) {
  if (status === 429) return "Too many requests (or the free limit is used up) — wait a bit and try again.";
  if (status === 400 || status === 401 || status === 403) return "Gemini key problem — check that GEMINI_API_KEY is set correctly.";
  return fallback;
}
