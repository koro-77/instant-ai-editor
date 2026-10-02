import { createFileRoute } from "@tanstack/react-router";
import { createParser } from "eventsource-parser";
import { z } from "zod";

const Body = z.object({
  instruction: z.string().max(4000),
  images: z.array(z.string().startsWith("data:image/")).min(1).max(6),
});

const SYSTEM = `You are a pro video colorist and motion editor. Look at the frames and the user's request, then pick effect settings that make the clip look amazing in that style (trending TikTok / Instagram / YouTube / Alight Motion edits).
Reply with ONLY a JSON object, no markdown, with these numeric keys:
brightness (0.5-1.6, 1 = none), contrast (0.5-1.8, 1 = none), saturate (0-2.5, 1 = none), hue (-180 to 180 degrees), sepia (0-1), grayscale (0-1), blur (0-4 px),
tint (CSS color string like "#ff8a3d", or "none"), tintStrength (0-0.6), vignette (0-1), grain (0-1), glow (0-1), rgbSplit (0-12 px),
shake (0-1, camera shake for velocity edits), zoomPulse (0-0.25, rhythmic zoom punch), speed (0.25-2, playback speed, 1 = normal), flash (0-1, white flash on beats),
letterbox (0-0.15, cinematic black bars height fraction), bpm (60-200, tempo the effects pulse to), glitch (0-1, digital slice glitches), invert (0-1, negative-color strobe on offbeats), speedRamp (0-1, slow-motion dips that snap fast on every beat), vertical (0 or 1, 1 = crop to 9:16 for Shorts/Reels/TikTok), and "name" (short style name).
Style guide: hard style / phonk / football edits = high contrast, strong shake, zoomPulse, flash, speedRamp, vignette, grain, rgbSplit, glitch, bpm 140+. Anime AMV = very saturated, glow, colored tint, rgbSplit, zoomPulse, flash, bpm 120-140. Shorts = vertical 1 unless the user says otherwise.`;

export const Route = createFileRoute("/api/video-style")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apiKey = process.env["LOVABLE_API_KEY"];
        if (!apiKey) return new Response("AI is not configured", { status: 500 });
        const parsed = Body.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return new Response("Please add a video first.", { status: 400 });
        const { instruction, images } = parsed.data;

        const upstream = await fetch("https://ai.gateway.lovable.dev/v1/responses", {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "X-Lovable-AIG-SDK": "fetch" },
          signal: request.signal,
          body: JSON.stringify({
            model: "openai/gpt-6-astra",
            stream: true,
            store: false,
            reasoning: { effort: "low" },
            instructions: SYSTEM,
            input: [
              {
                role: "user",
                content: [
                  { type: "input_text", text: `Style I want: ${instruction.trim() || "the best trending edit for this clip"}` },
                  ...images.map((url) => ({ type: "input_image", image_url: url })),
                ],
              },
            ],
          }),
        });
        if (!upstream.ok || !upstream.body) {
          const msg =
            upstream.status === 429 ? "Too many requests — try again in a moment." : upstream.status === 402 ? "AI credits have run out." : "Couldn't pick a style right now.";
          return new Response(msg, { status: upstream.status });
        }

        let text = "";
        const parser = createParser({
          onEvent(ev) {
            try {
              const d = JSON.parse(ev.data);
              if (d.type === "response.output_text.delta" && d.delta) text += d.delta;
            } catch {}
          },
        });
        const reader = upstream.body.pipeThrough(new TextDecoderStream()).getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          parser.feed(value);
        }
        const match = text.match(/\{[\s\S]*\}/);
        if (!match) return new Response("Couldn't pick a style — try again.", { status: 502 });
        try {
          return Response.json(JSON.parse(match[0]));
        } catch {
          return new Response("Couldn't pick a style — try again.", { status: 502 });
        }
      },
    },
  },
});
