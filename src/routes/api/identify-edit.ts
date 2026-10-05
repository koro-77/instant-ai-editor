import { createFileRoute } from "@tanstack/react-router";
import { createParser } from "eventsource-parser";
import { z } from "zod";

const Body = z.object({
  frames: z
    .array(z.object({ t: z.number().min(0), image: z.string().startsWith("data:image/") }))
    .min(1)
    .max(16),
});

const SYSTEM = `You are an expert short-form video editor (TikTok, Reels, Shorts, Alight Motion, CapCut).
You get frames from an example edit someone liked, each labelled with its timestamp. Work out what kind of edit it is.
Return:
- "name": the common name of this edit style (e.g. "Velocity edit", "Cinematic slow-mo edit", "Sad edit", "Anime AMV", "Sports hype edit").
- "description": 2-3 simple sentences (beginner language) on what makes it this style: pacing, effects, colors, shots used.
- "lookFor": one sentence describing the kind of moments to find in a raw video for this edit (e.g. "fast movements, strong poses and close-ups of the person").`;

const schema = {
  type: "object",
  additionalProperties: false,
  required: ["name", "description", "lookFor"],
  properties: { name: { type: "string" }, description: { type: "string" }, lookFor: { type: "string" } },
};

export const Route = createFileRoute("/api/identify-edit")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apiKey = process.env["LOVABLE_API_KEY"];
        if (!apiKey) return new Response("AI is not configured", { status: 500 });
        const parsed = Body.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return new Response("Please add an example edit first.", { status: 400 });

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
            text: { format: { type: "json_schema", name: "edit_style", strict: true, schema } },
            input: [
              {
                role: "user",
                content: parsed.data.frames.flatMap((f) => [
                  { type: "input_text", text: `Frame at ${f.t.toFixed(1)}s:` },
                  { type: "input_image", image_url: f.image },
                ]),
              },
            ],
          }),
        });

        if (!upstream.ok || !upstream.body) {
          const text = await upstream.text().catch(() => "");
          let msg = "Couldn't figure out the edit right now.";
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
        let bad = false;
        const parser = createParser({
          onEvent(ev) {
            try {
              const d = JSON.parse(ev.data);
              if (d.type === "response.output_text.delta" && d.delta) out += d.delta;
              else if (d.type === "response.refusal.delta" || d.type === "error" || d.type === "response.failed") bad = true;
            } catch {}
          },
        });
        const reader = upstream.body.pipeThrough(new TextDecoderStream()).getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          parser.feed(value);
        }
        try {
          if (bad) throw 0;
          const r = JSON.parse(out);
          return Response.json({ name: String(r.name), description: String(r.description), lookFor: String(r.lookFor) });
        } catch {
          return new Response("Couldn't figure out the edit — try again.", { status: 502 });
        }
      },
    },
  },
});
