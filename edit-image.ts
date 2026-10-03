import { createFileRoute } from "@tanstack/react-router";
import { errorMessage, geminiFetch, imageModel } from "@/lib/gemini.server";

// The editor page expects a server-sent-event stream that ends with an
// "image_edit.completed" event holding the finished picture as base64.
// Gemini returns the picture in one go, so we wrap it in that same shape.
export const Route = createFileRoute("/api/edit-image")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apiKey = process.env["GEMINI_API_KEY"];
        if (!apiKey) return new Response("Missing GEMINI_API_KEY", { status: 500 });

        const form = await request.formData();
        const prompt = form.get("prompt");
        const files = [...form.entries()]
          .filter(([name, value]) => (name === "image" || name === "image[]") && value instanceof File)
          .map(([, value]) => value as File);
        if (typeof prompt !== "string" || !prompt.trim() || files.length === 0) {
          return new Response("An image and edit instruction are required", { status: 400 });
        }

        const imageParts = await Promise.all(
          files.map(async (file) => ({
            inlineData: {
              mimeType: file.type || "image/png",
              data: Buffer.from(await file.arrayBuffer()).toString("base64"),
            },
          })),
        );

        const upstream = await geminiFetch(
          imageModel(),
          "generateContent",
          apiKey,
          {
            contents: [{ role: "user", parts: [{ text: prompt }, ...imageParts] }],
            generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
          },
          request.signal,
        );
        if (!upstream.ok) {
          return new Response(errorMessage(upstream.status, "Couldn't edit the image right now."), {
            status: upstream.status,
          });
        }

        const data = (await upstream.json().catch(() => null)) as {
          candidates?: { content?: { parts?: { inlineData?: { data?: string }; inline_data?: { data?: string } }[] } }[];
        } | null;
        const parts = data?.candidates?.[0]?.content?.parts ?? [];
        const b64 = parts.map((p) => p.inlineData?.data ?? p.inline_data?.data).find(Boolean);
        if (!b64) return new Response("Gemini didn't return an image — try a different prompt.", { status: 502 });

        const event = `event: image_edit.completed\ndata: ${JSON.stringify({ type: "image_edit.completed", b64_json: b64 })}\n\n`;
        return new Response(event, {
          headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
        });
      },
    },
  },
});
