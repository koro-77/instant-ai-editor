import { createFileRoute } from "@tanstack/react-router";
import { useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { streamImage } from "@/lib/stream-image";
import { PRESETS, VideoEditor, type VideoStyle } from "@/components/VideoEditor";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Cutline — AI photo & video editing coach" },
      { name: "description", content: "Upload a photo or video, say how to edit it, and get the edit plus a full step-by-step lesson in trending styles." },
      { property: "og:title", content: "Cutline — AI editing coach" },
      { property: "og:description", content: "Your AI edits photos as you say and teaches you trending TikTok, Instagram and YouTube styles." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

const QUICK = [
  "Cinematic movie grade",
  "Moody dark Instagram",
  "Bright clean TikTok",
  "Vintage film grain",
  "Anime / dreamy glow",
  "Neon cyberpunk night",
  "Velocity shake edit",
  "Y2K flash look",
  "Teal & orange",
  "Black & white color-pop",
  "RGB split glitch",
  "Golden hour warmth",
];
const APPS = ["Auto", "Alight Motion", "CapCut", "Lightroom", "Snapseed", "VN", "InShot", "PicsArt", "Photoshop", "Premiere Pro", "After Effects", "DaVinci Resolve"];

async function fileToDataUrl(f: Blob): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result as string);
    r.onerror = rej;
    r.readAsDataURL(f);
  });
}

async function shrink(dataUrl: string, max = 1280): Promise<string> {
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  const s = Math.min(1, max / Math.max(img.width, img.height));
  const c = document.createElement("canvas");
  c.width = img.width * s;
  c.height = img.height * s;
  c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.85);
}

async function videoFrames(file: File, count = 4): Promise<string[]> {
  const v = document.createElement("video");
  v.src = URL.createObjectURL(file);
  v.muted = true;
  await new Promise((r) => (v.onloadedmetadata = r));
  const frames: string[] = [];
  const c = document.createElement("canvas");
  const s = Math.min(1, 960 / Math.max(v.videoWidth, v.videoHeight));
  c.width = v.videoWidth * s;
  c.height = v.videoHeight * s;
  for (let i = 0; i < count; i++) {
    v.currentTime = (v.duration * (i + 0.5)) / count;
    await new Promise((r) => (v.onseeked = r));
    c.getContext("2d")!.drawImage(v, 0, 0, c.width, c.height);
    frames.push(c.toDataURL("image/jpeg", 0.8));
  }
  URL.revokeObjectURL(v.src);
  return frames;
}

function Index() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [instruction, setInstruction] = useState("");
  const [app, setApp] = useState("Auto");
  const [lesson, setLesson] = useState("");
  const [edited, setEdited] = useState<string | null>(null);
  const [editFinal, setEditFinal] = useState(false);
  const [vStyle, setVStyle] = useState<VideoStyle | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const isVideo = file?.type.startsWith("video/") ?? false;

  const pick = (f: File | undefined) => {
    if (!f) return;
    setFile(f);
    setPreview(URL.createObjectURL(f));
    setLesson("");
    setEdited(null);
    setVStyle(null);
    setError(null);
  };

  const run = async () => {
    if (!file || busy) return;
    setBusy(true);
    setError(null);
    setLesson("");
    setEdited(null);
    setEditFinal(false);
    try {
      const images = isVideo ? await videoFrames(file) : [await shrink(await fileToDataUrl(file))];

      const coach = (async () => {
        const res = await fetch("/api/coach", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ instruction, app, mode: isVideo ? "video" : "photo", images }),
        });
        if (!res.ok || !res.body) throw new Error(await res.text());
        const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          setLesson((p) => p + value);
        }
      })();

      setVStyle(null);
      const edit = isVideo
        ? (async () => {
            const res = await fetch("/api/video-style", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ instruction, images }),
            });
            if (!res.ok) throw new Error(await res.text());
            setVStyle(await res.json());
          })()
        : (async () => {
            const blob = await (await fetch(images[0]!)).blob();
            const form = new FormData();
            form.append("image", new File([blob], "photo.jpg", { type: "image/jpeg" }));
            form.append(
              "prompt",
              `Edit this photo: ${instruction.trim() || "apply the best trending social media edit style for it"}. Keep the same people, subject, framing and composition — only change color grading, lighting and style.`,
            );
            await streamImage("/api/edit-image", form, (src, fin) => {
              setEdited(src);
              setEditFinal(fin);
            });
          })();

      const results = await Promise.allSettled([coach, edit]);
      const failed = results.find((r) => r.status === "rejected") as PromiseRejectedResult | undefined;
      if (failed) setError(String(failed.reason?.message ?? failed.reason).slice(0, 200));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto min-h-screen max-w-6xl px-5 py-10">
      <header className="mb-10 text-center">
        <p className="text-sm font-semibold uppercase tracking-[0.3em] text-primary">Cutline</p>
        <h1 className="font-display text-6xl leading-none text-foreground md:text-8xl">Edit it. Learn it.</h1>
        <p className="mx-auto mt-4 max-w-xl text-muted-foreground">
          Drop a photo or video, tell the AI how you want it — it does the edit, picks trending styles from TikTok, Instagram & YouTube, and teaches you every step.
        </p>
      </header>

      <section className="grid gap-6 md:grid-cols-2">
        <div className="rounded-[var(--radius)] border border-border bg-card p-5">
          <button
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              pick(e.dataTransfer.files[0]);
            }}
            className="grain flex aspect-[4/3] w-full items-center justify-center overflow-hidden rounded-[var(--radius)] border-2 border-dashed border-border bg-muted text-muted-foreground transition hover:border-primary"
          >
            {preview ? (
              isVideo ? (
                <video src={preview} controls className="h-full w-full object-contain" />
              ) : (
                <img src={preview} alt="Your upload" className="h-full w-full object-contain" />
              )
            ) : (
              <span className="px-6 text-center">
                <span className="font-display block text-3xl text-foreground">Drop a photo or video</span>
                or tap to choose
              </span>
            )}
          </button>
          <input ref={inputRef} type="file" accept="image/*,video/*" hidden onChange={(e) => pick(e.target.files?.[0])} />

          <textarea
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            placeholder="Say how to edit it… e.g. warmer colors, make it look like a movie"
            rows={3}
            className="mt-4 w-full resize-none rounded-[var(--radius)] border border-input bg-background p-3 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <div className="mt-2 flex flex-wrap gap-2">
            {QUICK.map((q) => (
              <button key={q} onClick={() => setInstruction(q)} className="rounded-full bg-secondary px-3 py-1 text-sm text-secondary-foreground hover:bg-muted">
                {q}
              </button>
            ))}
          </div>
          <p className="mt-4 text-sm font-semibold text-muted-foreground">Teach me in</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {APPS.map((a) => (
              <button
                key={a}
                onClick={() => setApp(a)}
                className={`rounded-full px-3 py-1 text-sm transition ${a === app ? "bg-accent text-accent-foreground" : "bg-secondary text-secondary-foreground hover:bg-muted"}`}
              >
                {a}
              </button>
            ))}
          </div>
          <button
            onClick={run}
            disabled={!file || busy}
            className="shadow-glow mt-5 w-full rounded-[var(--radius)] bg-primary py-3 font-display text-2xl tracking-wide text-primary-foreground transition hover:brightness-110 disabled:opacity-40 disabled:shadow-none"
          >
            {busy ? "Working on it…" : "Edit + teach me"}
          </button>
          {isVideo && <p className="mt-2 text-xs text-muted-foreground">The AI edits your video (colors, glow, shake, zoom, flashes and more) and teaches you how to do it yourself.</p>}
          {isVideo && (
            <div className="mt-4">
              <p className="mb-2 text-xs uppercase tracking-widest text-muted-foreground">Instant styles (no AI wait)</p>
              <div className="flex flex-wrap gap-2">
                {Object.entries(PRESETS).map(([label, st]) => (
                  <button
                    key={label}
                    onClick={() => setVStyle(st)}
                    className="rounded-full border border-border px-4 py-1.5 text-sm font-semibold hover:border-primary hover:text-primary"
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}
          {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
        </div>

        <div className="space-y-6">
          {isVideo && preview && (vStyle || busy) && (
            <div className="rounded-[var(--radius)] border border-border bg-card p-5">
              <h2 className="font-display text-3xl text-primary">Your edit{vStyle?.name ? ` — ${vStyle.name}` : ""}</h2>
              <div className="mt-3">
                {vStyle ? <VideoEditor src={preview} style={vStyle} /> : <p className="animate-pulse text-muted-foreground">Editing your video…</p>}
              </div>
            </div>
          )}
          {(edited || (busy && !isVideo)) && (
            <div className="rounded-[var(--radius)] border border-border bg-card p-5">
              <h2 className="font-display text-3xl text-primary">Your edit</h2>
              <div className="mt-3 flex aspect-[4/3] items-center justify-center overflow-hidden rounded-[var(--radius)] bg-muted">
                {edited ? (
                  <img src={edited} alt="Edited result" className={`h-full w-full object-contain transition-[filter] duration-500 ${editFinal ? "blur-0" : "blur-2xl"}`} />
                ) : (
                  <span className="animate-pulse text-muted-foreground">Editing your photo…</span>
                )}
              </div>
              {edited && editFinal && (
                <a href={edited} download="cutline-edit.png" className="mt-3 inline-block text-sm font-semibold text-primary hover:underline">
                  Download edit
                </a>
              )}
              {edited && editFinal && !busy && (
                <button
                  onClick={async () => {
                    const blob = await (await fetch(edited)).blob();
                    pick(new File([blob], "edit.png", { type: "image/png" }));
                    setInstruction("");
                  }}
                  className="ml-4 mt-3 inline-block text-sm font-semibold text-accent hover:underline"
                >
                  Keep editing this
                </button>
              )}
            </div>
          )}

          <div className="rounded-[var(--radius)] border border-border bg-card p-5">
            <h2 className="font-display text-3xl text-accent">Your lesson</h2>
            {lesson ? (
              <div className="prose-lesson mt-3 space-y-3 text-card-foreground [&_h1]:font-display [&_h2]:font-display [&_h2]:text-2xl [&_h3]:font-semibold [&_li]:ml-5 [&_ol]:list-decimal [&_strong]:text-primary [&_ul]:list-disc">
                <ReactMarkdown>{lesson}</ReactMarkdown>
              </div>
            ) : (
              <p className="mt-3 text-muted-foreground">{busy ? "Studying your shot…" : "Your step-by-step lesson will show up here."}</p>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
