import { createFileRoute } from "@tanstack/react-router";
import { createParser } from "eventsource-parser";
import { z } from "zod";

const Body = z.object({
  instruction: z.string().max(2000),
  duration: z.number().positive().max(36000),
  frames: z
    .array(z.object({ t: z.number().min(0), image: z.string().startsWith("data:image/") }))
    .min(1)
    .max(24),
});

const SYSTEM = `You are "Cutline", an expert short-form video editor (TikTok, Reels, Shorts, Alight Motion, CapCut).
You get frames sampled from ONE video, each labelled with its timestamp in seconds, plus what the user wants: the type of edit and usually a person or thing to focus on.
Find the best moments in the video to use for that edit. Rules:
- Only pick moments where the named person/thing is clearly visible (if one was named).
- Match the edit type: velocity/hype edits want action, motion and strong poses; cinematic/sad edits want calm, emotional, well-lit shots; funny edits want reactions, etc.
- Each clip's start and end must be between 0 and the video duration, end > start, typically 1-5 seconds long, and must not overlap.
- Return 3 to 8 clips, best first, with a 1-10 score and a short simple reason (beginner language, max 20 words).
- "tip": one short sentence on how to arrange these clips for this edit.
If nothing fits, return an empty clips list and explain why in "tip".`;

const schema = {
  type: "object",
  additionalProperties: false,
  required: ["clips", "tip"],
  properties: {
    tip: { type: "string" },
    clips: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["start", "end", "score", "reason"],
        properties: {
          start: { type: "number" },
          end: { type: "number" },
          score: { type: "number" },
          reason: { type: "string" },
        },
      },
    },
  },
};

const Result = z.object({
  tip: z.string().catch(""),
  clips: z
    .array(z.object({ start: z.number(), end: z.number(), score: z.number().catch(5), reason: z.string().catch("") }))
    .catch([]),
});

export const Route = createFileRoute("/api/find-clips")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apiKey = process.env["LOVABLE_API_KEY"];
        if (!apiKey) return new Response("AI is not configured", { status: 500 });
        const parsed = Body.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return new Response("Please add a video first.", { status: 400 });
        const { instruction, duration, frames } = parsed.data;

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
            text: { format: { type: "json_schema", name: "clips", strict: true, schema } },
            input: [
              {
                role: "user",
                content: [
                  {
                    type: "input_text",
                    text: `Video duration: ${duration.toFixed(1)}s.\nWhat I want: ${instruction.trim() || "the best moments for a trending edit"}`,
                  },
                  ...frames.flatMap((f) => [
                    { type: "input_text", text: `Frame at ${f.t.toFixed(1)}s:` },
                    { type: "input_image", image_url: f.image },
                  ]),
                ],
              },
            ],
          }),
        });

        if (!upstream.ok || !upstream.body) {
          const text = await upstream.text().catch(() => "");
          let msg = "Couldn't find clips right now.";
          if (upstream.status === 429) msg = "Too many requests — wait a moment and try again.";
          else if (upstream.status === 402) msg = "The free AI allowance is used up for now — it refills next month.";
          else {
            try {
              msg = JSON.parse(text)?.error?.message ?? msg;
            } catch {}
          }
          return new Response(msg, { status: upstream.status });
        }

        let out = "";
        let refused = false;
        let failed = false;
        const parser = createParser({
          onEvent(ev) {
            try {
              const d = JSON.parse(ev.data);
              if (d.type === "response.output_text.delta" && d.delta) out += d.delta;
              else if (d.type === "response.refusal.delta") refused = true;
              else if (d.type === "error" || d.type === "response.failed") failed = true;
            } catch {}
          },
        });
        const reader = upstream.body.pipeThrough(new TextDecoderStream()).getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          parser.feed(value);
        }
        if (refused) return new Response("Sorry, I can't help with that video.", { status: 422 });
        if (failed || !out) return new Response("Couldn't find clips — try again.", { status: 502 });

        try {
          const r = Result.parse(JSON.parse(out));
          const clips = r.clips
            .map((c) => ({
              ...c,
              start: Math.max(0, Math.min(duration, c.start)),
              end: Math.max(0, Math.min(duration, c.end)),
              score: Math.max(1, Math.min(10, Math.round(c.score))),
            }))
            .filter((c) => c.end - c.start >= 0.3)
            .slice(0, 8);
          return Response.json({ tip: r.tip, clips });
        } catch {
          return new Response("Couldn't find clips — try again.", { status: 502 });
        }
      },
    },
  },
});
