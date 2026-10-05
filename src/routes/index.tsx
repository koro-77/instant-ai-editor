import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Cutline — AI finds the best clips for your edit" },
      { name: "description", content: "Upload a video, say the edit and who it's about, and AI finds the best moments to use." },
      { property: "og:title", content: "Cutline — AI clip finder" },
      { property: "og:description", content: "AI watches your video and picks the best moments for velocity, cinematic, funny and other edits." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

const QUICK = [
  "Velocity edit",
  "Cinematic edit",
  "Sad / emotional edit",
  "Funny moments",
  "Hype sports edit",
  "Anime-style edit",
  "Aesthetic vlog",
  "Best goals / highlights",
];

type Clip = { start: number; end: number; score: number; reason: string };

const fmt = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;

async function sampleFrames(file: File, count = 16) {
  const v = document.createElement("video");
  v.src = URL.createObjectURL(file);
  v.muted = true;
  v.preload = "auto";
  await new Promise((r, j) => ((v.onloadeddata = r), (v.onerror = () => j(new Error("Can't read this video")))));
  const duration = v.duration;
  const c = document.createElement("canvas");
  const s = Math.min(1, 512 / Math.max(v.videoWidth, v.videoHeight));
  c.width = Math.round(v.videoWidth * s);
  c.height = Math.round(v.videoHeight * s);
  const n = Math.max(1, Math.min(count, Math.ceil(duration * 2)));
  const frames: { t: number; image: string }[] = [];
  for (let i = 0; i < n; i++) {
    const t = (duration * (i + 0.5)) / n;
    await new Promise((r) => ((v.onseeked = r), (v.currentTime = t)));
    c.getContext("2d")!.drawImage(v, 0, 0, c.width, c.height);
    frames.push({ t, image: c.toDataURL("image/jpeg", 0.7) });
  }
  URL.revokeObjectURL(v.src);
  return { duration, frames };
}

function Index() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [instruction, setInstruction] = useState("");
  const [clips, setClips] = useState<Clip[] | null>(null);
  const [tip, setTip] = useState("");
  const [active, setActive] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const pick = (f: File | undefined) => {
    if (!f) return;
    if (!f.type.startsWith("video/")) return setError("Please choose a video.");
    setFile(f);
    setPreview(URL.createObjectURL(f));
    setClips(null);
    setTip("");
    setError(null);
  };

  const run = async () => {
    if (!file || busy) return;
    setBusy(true);
    setError(null);
    setClips(null);
    try {
      const { duration, frames } = await sampleFrames(file);
      const res = await fetch("/api/find-clips", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instruction, duration, frames }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as { tip: string; clips: Clip[] };
      setClips(data.clips);
      setTip(data.tip);
    } catch (e) {
      setError(e instanceof Error ? e.message.slice(0, 200) : "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  const play = (i: number) => {
    const v = videoRef.current;
    const c = clips?.[i];
    if (!v || !c) return;
    setActive(i);
    v.currentTime = c.start;
    v.play();
  };

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onTime = () => {
      const c = active != null ? clips?.[active] : null;
      if (c && v.currentTime >= c.end) {
        v.pause();
        setActive(null);
      }
    };
    v.addEventListener("timeupdate", onTime);
    return () => v.removeEventListener("timeupdate", onTime);
  }, [active, clips]);

  return (
    <main className="mx-auto min-h-screen max-w-6xl px-5 py-10">
      <header className="mb-10 text-center">
        <p className="text-sm font-semibold uppercase tracking-[0.3em] text-primary">Cutline</p>
        <h1 className="font-display text-6xl leading-none text-foreground md:text-8xl">Find the moments.</h1>
        <p className="mx-auto mt-4 max-w-xl text-muted-foreground">
          Drop a video, say the edit you want and who or what it's about — the AI watches it and picks the best clips to use.
        </p>
      </header>

      <section className="grid gap-6 md:grid-cols-2">
        <div className="rounded-[var(--radius)] border border-border bg-card p-5">
          {preview ? (
            <div className="overflow-hidden rounded-[var(--radius)] bg-muted">
              <video ref={videoRef} src={preview} controls playsInline className="aspect-video w-full object-contain" />
            </div>
          ) : (
            <button
              onClick={() => inputRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                pick(e.dataTransfer.files[0]);
              }}
              className="grain flex aspect-video w-full items-center justify-center rounded-[var(--radius)] border-2 border-dashed border-border bg-muted text-muted-foreground transition hover:border-primary"
            >
              <span className="px-6 text-center">
                <span className="font-display block text-3xl text-foreground">Drop a video</span>
                or tap to choose
              </span>
            </button>
          )}
          {preview && (
            <button onClick={() => inputRef.current?.click()} className="mt-2 text-sm font-semibold text-accent hover:underline">
              Choose another video
            </button>
          )}
          <input ref={inputRef} type="file" accept="video/*" hidden onChange={(e) => pick(e.target.files?.[0])} />

          <textarea
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            placeholder="e.g. velocity edit of the guy in the red shirt, or cinematic edit of my dog"
            rows={3}
            className="mt-4 w-full resize-none rounded-[var(--radius)] border border-input bg-background p-3 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <div className="mt-2 flex flex-wrap gap-2">
            {QUICK.map((q) => (
              <button
                key={q}
                onClick={() => setInstruction((p) => (p.trim() ? `${q} — ${p}` : `${q} of `))}
                className="rounded-full bg-secondary px-3 py-1 text-sm text-secondary-foreground hover:bg-muted"
              >
                {q}
              </button>
            ))}
          </div>
          <button
            onClick={run}
            disabled={!file || busy}
            className="shadow-glow mt-5 w-full rounded-[var(--radius)] bg-primary py-3 font-display text-2xl tracking-wide text-primary-foreground transition hover:brightness-110 disabled:opacity-40 disabled:shadow-none"
          >
            {busy ? "Watching your video…" : "Find the best clips"}
          </button>
          {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
        </div>

        <div className="rounded-[var(--radius)] border border-border bg-card p-5">
          <h2 className="font-display text-3xl text-accent">Best clips</h2>
          {clips && clips.length > 0 ? (
            <ol className="mt-3 space-y-3">
              {clips.map((c, i) => (
                <li key={i}>
                  <button
                    onClick={() => play(i)}
                    className={`w-full rounded-[var(--radius)] border p-3 text-left transition ${active === i ? "border-primary bg-muted" : "border-border hover:border-primary"}`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-display text-2xl text-primary">
                        #{i + 1} · {fmt(c.start)} – {fmt(c.end)}
                      </span>
                      <span className="text-sm font-semibold text-accent">{c.score}/10</span>
                    </div>
                    <p className="mt-1 text-sm text-card-foreground">{c.reason}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{active === i ? "Playing…" : "Tap to watch"}</p>
                  </button>
                </li>
              ))}
            </ol>
          ) : (
            <p className="mt-3 text-muted-foreground">
              {busy ? "Looking for the best moments…" : clips ? "No good moments found." : "Your best moments will show up here."}
            </p>
          )}
          {tip && (
            <p className="mt-4 text-sm text-card-foreground">
              <strong className="text-primary">Tip:</strong> {tip}
            </p>
          )}
        </div>
      </section>
    </main>
  );
}
