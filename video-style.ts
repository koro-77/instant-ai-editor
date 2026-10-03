import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { dataUrlToPart, errorMessage, geminiFetch, textModel } from "@/lib/gemini.server";

const Body = z.object({
  instruction: z.string().max(4000),
  images: z.array(z.string().startsWith("data:image/")).min(1).max(6),
});

// Clamp every value the model returns so a bad or extreme answer can never
// overcook the clip: wrong types fall back to the neutral default, and
// out-of-range numbers are clamped into their documented range.
const num = (lo: number, hi: number, def: number) =>
  z
    .number()
    .catch(def)
    .transform((v) => Math.min(hi, Math.max(lo, v)));

const Style = z.object({
  name: z.string().catch("").transform((s) => s.trim().slice(0, 40)),
  brightness: num(0.5, 1.6, 1),
  contrast: num(0.5, 1.8, 1),
  saturate: num(0, 2.5, 1),
  hue: num(-180, 180, 0),
  sepia: num(0, 1, 0),
  grayscale: num(0, 1, 0),
  blur: num(0, 4, 0),
  tint: z
    .string()
    .catch("none")
    .transform((s) => (/^#[0-9a-fA-F]{3,8}$/.test(s.trim()) ? s.trim().toLowerCase() : "none")),
  tintStrength: num(0, 0.6, 0),
  vignette: num(0, 1, 0),
  grain: num(0, 1, 0),
  glow: num(0, 1, 0),
  rgbSplit: num(0, 12, 0),
  shake: num(0, 1, 0),
  zoomPulse: num(0, 0.25, 0),
  speed: num(0.25, 2, 1),
  flash: num(0, 1, 0),
  letterbox: num(0, 0.15, 0),
});

const SYSTEM = `You are the world's best short-form video colorist: the taste behind viral YouTube Shorts, TikToks and Reels (Alight Motion velocity edits, CapCut trends, cinematic grades).
You receive frames from the clip plus the user's request, and you return effect settings that make the clip look premium and intentional — never cheap, never overcooked.

Reply with ONLY one JSON object, no markdown and no commentary, with exactly these keys:
brightness (0.5-1.6, 1 = none), contrast (0.5-1.8, 1 = none), saturate (0-2.5, 1 = none), hue (-180 to 180 degrees), sepia (0-1), grayscale (0-1), blur (0-4 px),
tint (hex color like "#ff8a3d", or "none"), tintStrength (0-0.6), vignette (0-1), grain (0-1), glow (0-1), rgbSplit (0-12 px),
shake (0-1), zoomPulse (0-0.25), speed (0.25-2, playback speed, 1 = normal), flash (0-1), letterbox (0-0.15),
and "name" (short style name).

HARD RULES
1. Vague requests — "make it better", "make it pop", "best edit", "improve it", "do your thing", or an empty instruction — mean: give this exact clip a clearly VISIBLE premium upgrade while keeping its identity. The difference must be obvious in a side-by-side comparison with the original: punchier contrast, richer cleaner color, brighter confident light — still natural, never HDR-cheap. Use at least 4 of these, each meaningfully away from neutral (never everything within 5% of 1): contrast 1.1-1.22, saturate 1.12-1.3, brightness 1.02-1.12 (0.94-1.0 if the clip is already bright), vignette 0.1-0.28, grain 0.05-0.2, a flattering tint with tintStrength 0.08-0.2, glow 0.05-0.15 when it flatters, letterbox 0.06-0.12 only for cinematic-feeling clips. Example vague-answer shape: contrast 1.16, saturate 1.2, brightness 1.05, vignette 0.18, grain 0.1, tint "#ffd9a0" tintStrength 0.12. Force shake 0, flash 0, rgbSplit 0, speed 1, grayscale 0, sepia 0, blur 0, hue 0.
2. Motion effects are spices, not the meal: shake <=0.25, zoomPulse <=0.15, flash <=0.25, rgbSplit <=6 — unless the user explicitly asks for velocity, glitch or hype edits, then use the full range on those keys only.
3. speed stays 1 unless the user explicitly asks to slow down, speed up, or timelapse.
4. Set only the keys your chosen style actually needs — usually 3 to 6 keys non-zero. Never switch everything on at once.
5. People must look good: natural skin tones, no hue swings and no grayscale/sepia on faces unless the user explicitly asked for black and white.
6. Judge the style from the actual frames (light, subject, motion), and honor an explicitly named style faithfully.

STYLE PRESET CHEAT SHEET (calibration only — blend with what you see in the frames):
Cinematic: contrast 1.12, saturate 1.05, letterbox 0.12, vignette 0.2, tint "#0f1c2e" tintStrength 0.15, grain 0.15 — name "Cinematic"
Moody dark: brightness 0.93, contrast 1.15, saturate 0.9, vignette 0.3, tint "#1b2430" tintStrength 0.2 — name "Moody Dark"
Clean bright TikTok: brightness 1.08, contrast 1.08, saturate 1.15 — name "Clean Pop"
Y2K flash: contrast 1.2, saturate 1.35, tint "#ff4fd8" tintStrength 0.25, flash 0.15, grain 0.25 — name "Y2K"
Neon night: brightness 0.95, contrast 1.2, saturate 1.4, tint "#2b00ff" tintStrength 0.3, glow 0.35, vignette 0.25 — name "Neon Night"
Velocity / Alight Motion: zoomPulse 0.12, shake 0.15, rgbSplit 3, glow 0.2, flash 0.12 — name "Velocity"
Anime dreamy glow: brightness 1.06, saturate 1.3, glow 0.4, tint "#ffd9ec" tintStrength 0.2, blur 0.5 — name "Dreamy Glow"
Golden hour: brightness 1.05, contrast 1.05, saturate 1.2, sepia 0.15, tint "#ff9a3d" tintStrength 0.25 — name "Golden Hour"
Teal and orange: contrast 1.12, saturate 1.15, tint "#0e6b78" tintStrength 0.2, hue -6 — name "Teal & Orange"
Black and white punch: grayscale 1, contrast 1.2, grain 0.2 — name "Mono Punch"
RGB glitch: rgbSplit 8, contrast 1.15, shake 0.1 — name "RGB Glitch"
Vintage film: sepia 0.25, grain 0.4, contrast 1.05, vignette 0.2, tint "#ffd9a0" tintStrength 0.15 — name "Vintage Film"

Every number must sit inside its stated range.`;

export const Route = createFileRoute("/api/video-style")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apiKey = process.env["GEMINI_API_KEY"];
        if (!apiKey) return new Response("AI is not configured", { status: 500 });
        const parsed = Body.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return new Response("Please add a video first.", { status: 400 });
        const { instruction, images } = parsed.data;

        const upstream = await geminiFetch(
          textModel(),
          "generateContent",
          apiKey,
          {
            systemInstruction: { parts: [{ text: SYSTEM }] },
            contents: [
              {
                role: "user",
                parts: [
                  { text: `Style I want: ${instruction.trim() || "the best trending edit for this clip"}` },
                  ...images.map(dataUrlToPart),
                ],
              },
            ],
            generationConfig: { responseMimeType: "application/json" },
          },
          request.signal,
        );
        if (!upstream.ok) {
          return new Response(errorMessage(upstream.status, "Couldn't pick a style right now."), {
            status: upstream.status,
          });
        }

        const data = (await upstream.json().catch(() => null)) as {
          candidates?: { content?: { parts?: { text?: string }[] } }[];
        } | null;
        const text = (data?.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("");
        const match = text.match(/\{[\s\S]*\}/);
        if (!match) return new Response("Couldn't pick a style — try again.", { status: 502 });
        try {
          // Sanitize: every key validated, defaulted and clamped before it
          // ever reaches the renderer.
          return Response.json(Style.parse(JSON.parse(match[0])));
        } catch {
          return new Response("Couldn't pick a style — try again.", { status: 502 });
        }
      },
    },
  },
});
