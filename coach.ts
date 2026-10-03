import { createFileRoute } from "@tanstack/react-router";
import { createParser } from "eventsource-parser";
import { z } from "zod";
import { dataUrlToPart, errorMessage, geminiFetch, textModel } from "@/lib/gemini.server";

const Body = z.object({
  instruction: z.string().max(4000),
  mode: z.enum(["photo", "video"]),
  app: z.string().max(60).default("Auto"),
  images: z.array(z.string().startsWith("data:image/")).min(1).max(6),
});

const SYSTEM = `You are "Cutline", a friendly editing coach for photos and short videos.
You know the editing styles trending on YouTube, TikTok and Instagram (e.g. film grain + faded blacks, teal & orange, clean bright "Insta" look, moody dark, Y2K flash, velocity edits, beat-synced cuts, zoom transitions, captions styles, Alight Motion shake/glow/flash velocity edits, 3D camera, motion blur, RGB split, anime edits, color-pop, dreamy glow, CC overlays). Be creative and give pro-level, impressive edits — not basic ones.
Look carefully at the media the user shared and their request. Respond in markdown with:
1. **What I see** – 2-3 sentences about the shot (light, colors, subject, mood).
2. **Best edit styles for this** – 3 styles that fit, each with one line on why it works and where it's popular.
3. **Full lesson** – a beginner-friendly numbered step-by-step lesson to do the edit the user asked for (or the best style if they didn't say), written for the app the user picked (Alight Motion, CapCut, Lightroom, Snapseed, VN, InShot, Premiere Pro, After Effects, DaVinci Resolve, Photoshop, PicsArt, etc.) using that app's real menu names, effect names, keyframes and exact values. If they picked "Auto", choose the best app for this edit and say why. Explain WHY each step matters.
4. **Pro tip** – one short tip.
For videos you get a few frames from the clip; mention timing, cuts, music and transitions too.
Keep the language simple — the user is a beginner.`;

export const Route = createFileRoute("/api/coach")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apiKey = process.env["GEMINI_API_KEY"];
        if (!apiKey) return new Response("AI is not configured", { status: 500 });
        const parsed = Body.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return new Response("Please add a photo or video first.", { status: 400 });
        const { instruction, mode, images, app } = parsed.data;

        const upstream = await geminiFetch(
          textModel(),
          "streamGenerateContent",
          apiKey,
          {
            systemInstruction: { parts: [{ text: SYSTEM }] },
            contents: [
              {
                role: "user",
                parts: [
                  {
                    text: `Media type: ${mode}${mode === "video" ? ` (${images.length} frames from the clip)` : ""}.\nApp I want to learn in: ${app}.\nWhat I want: ${instruction.trim() || "Suggest the best edit style and teach me how."}`,
                  },
                  ...images.map(dataUrlToPart),
                ],
              },
            ],
          },
          request.signal,
        );

        if (!upstream.ok || !upstream.body) {
          return new Response(errorMessage(upstream.status, "The coach couldn't answer right now."), {
            status: upstream.status,
          });
        }

        const encoder = new TextEncoder();
        const pending: Uint8Array[] = [];
        const parser = createParser({
          onEvent(ev) {
            try {
              const d = JSON.parse(ev.data);
              const parts = d?.candidates?.[0]?.content?.parts ?? [];
              for (const part of parts) {
                if (typeof part.text === "string" && part.text) pending.push(encoder.encode(part.text));
              }
              if (d?.promptFeedback?.blockReason) {
                pending.push(encoder.encode("\n\nSorry, I can't help with that one."));
              }
            } catch {}
          },
        });

        const stream = new ReadableStream<Uint8Array>({
          async start(controller) {
            const reader = upstream.body!.pipeThrough(new TextDecoderStream()).getReader();
            try {
              while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                parser.feed(value);
                while (pending.length) controller.enqueue(pending.shift()!);
              }
            } catch {
              // client stopped
            } finally {
              controller.close();
            }
          },
        });

        return new Response(stream, {
          headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-cache, no-transform" },
        });
      },
    },
  },
});
