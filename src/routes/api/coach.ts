import { createFileRoute } from "@tanstack/react-router";
import { createParser } from "eventsource-parser";
import { z } from "zod";

const Body = z.object({
  instruction: z.string().max(4000),
  mode: z.enum(["photo", "video"]),
  images: z.array(z.string().startsWith("data:image/")).min(1).max(6),
});

const SYSTEM = `You are "Cutline", a friendly editing coach for photos and short videos.
You know the editing styles trending on YouTube, TikTok and Instagram (e.g. film grain + faded blacks, teal & orange, clean bright "Insta" look, moody dark, Y2K flash, velocity edits, beat-synced cuts, zoom transitions, captions styles).
Look carefully at the media the user shared and their request. Respond in markdown with:
1. **What I see** – 2-3 sentences about the shot (light, colors, subject, mood).
2. **Best edit styles for this** – 3 styles that fit, each with one line on why it works and where it's popular.
3. **Full lesson** – a beginner-friendly numbered step-by-step lesson to do the edit the user asked for (or the best style if they didn't say), with exact slider values for free apps (Lightroom Mobile / Snapseed for photos, CapCut for video). Explain WHY each step matters.
4. **Pro tip** – one short tip.
${"For videos you get a few frames from the clip; mention timing, cuts, music and transitions too."}
Keep the language simple — the user is a beginner.`;

export const Route = createFileRoute("/api/coach")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apiKey = process.env["LOVABLE_API_KEY"];
        if (!apiKey) return new Response("AI is not configured", { status: 500 });
        const parsed = Body.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return new Response("Please add a photo or video first.", { status: 400 });
        const { instruction, mode, images } = parsed.data;

        const upstream = await fetch("https://ai.gateway.lovable.dev/v1/responses", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            "X-Lovable-AIG-SDK": "fetch",
          },
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
                  {
                    type: "input_text",
                    text: `Media type: ${mode}${mode === "video" ? ` (${images.length} frames from the clip)` : ""}.\nWhat I want: ${instruction.trim() || "Suggest the best edit style and teach me how."}`,
                  },
                  ...images.map((url) => ({ type: "input_image", image_url: url })),
                ],
              },
            ],
          }),
        });

        if (!upstream.ok || !upstream.body) {
          const text = await upstream.text().catch(() => "");
          let msg = "The coach couldn't answer right now.";
          if (upstream.status === 429) msg = "Too many requests — wait a moment and try again.";
          else if (upstream.status === 402) msg = "AI credits have run out for this workspace.";
          else {
            try {
              msg = JSON.parse(text)?.error?.message ?? msg;
            } catch {}
          }
          return new Response(msg, { status: upstream.status });
        }

        const encoder = new TextEncoder();
        const out = new TransformStream<string, Uint8Array>({
          start() {},
          transform(chunk, controller) {
            parser.feed(chunk);
            function noop() {}
            noop();
            void controller;
          },
        });
        const writer = out.writable.getWriter();
        let refused = false;
        const parser = createParser({
          onEvent(ev) {
            try {
              const d = JSON.parse(ev.data);
              if (d.type === "response.output_text.delta" && d.delta) {
                pending.push(encoder.encode(d.delta));
              } else if (d.type === "response.refusal.delta" && !refused) {
                refused = true;
                pending.push(encoder.encode("\n\nSorry, I can't help with that one."));
              } else if (d.type === "error" || d.type === "response.failed") {
                pending.push(encoder.encode("\n\n_Something went wrong while answering._"));
              }
            } catch {}
          },
        });
        const pending: Uint8Array[] = [];
        void writer;

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
