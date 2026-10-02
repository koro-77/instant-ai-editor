import { useEffect, useRef, useState } from "react";

export type VideoStyle = {
  name?: string;
  brightness?: number;
  contrast?: number;
  saturate?: number;
  hue?: number;
  sepia?: number;
  grayscale?: number;
  blur?: number;
  tint?: string;
  tintStrength?: number;
  vignette?: number;
  grain?: number;
  glow?: number;
  rgbSplit?: number;
  shake?: number;
  zoomPulse?: number;
  speed?: number;
  flash?: number;
  letterbox?: number;
};

const n = (v: unknown, d: number, lo: number, hi: number) => {
  const x = typeof v === "number" && isFinite(v) ? v : d;
  return Math.min(hi, Math.max(lo, x));
};

const GRAIN_TILE = 128;

const fmt = (s: number) => {
  if (!isFinite(s) || s < 0) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
};

function drawFrame(ctx: CanvasRenderingContext2D, video: HTMLVideoElement, s: VideoStyle, t: number, grainPattern: CanvasPattern | null) {
  const { width: W, height: H } = ctx.canvas;
  const filter = `brightness(${n(s.brightness, 1, 0.3, 2)}) contrast(${n(s.contrast, 1, 0.3, 2.5)}) saturate(${n(s.saturate, 1, 0, 3)}) hue-rotate(${n(s.hue, 0, -180, 180)}deg) sepia(${n(s.sepia, 0, 0, 1)}) grayscale(${n(s.grayscale, 0, 0, 1)}) blur(${n(s.blur, 0, 0, 6)}px)`;
  const beat = (t * 2) % 1; // ~120 bpm
  const punch = n(s.zoomPulse, 0, 0, 0.3) * Math.max(0, 1 - beat * 4);
  const shake = n(s.shake, 0, 0, 1) * W * 0.03;
  const dx = shake ? (Math.sin(t * 47) + Math.sin(t * 31)) * shake * 0.5 : 0;
  const dy = shake ? (Math.cos(t * 41) + Math.sin(t * 23)) * shake * 0.5 : 0;
  const scale = 1 + punch + (shake ? 0.06 : 0);

  ctx.save();
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, W, H);
  ctx.translate(W / 2 + dx, H / 2 + dy);
  ctx.scale(scale, scale);
  ctx.filter = filter;
  ctx.drawImage(video, -W / 2, -H / 2, W, H);
  const split = n(s.rgbSplit, 0, 0, 20);
  if (split > 0.5) {
    ctx.globalCompositeOperation = "screen";
    ctx.globalAlpha = 0.35;
    ctx.filter = `${filter} sepia(1) saturate(6) hue-rotate(-50deg)`;
    ctx.drawImage(video, -W / 2 - split, -H / 2, W, H);
    ctx.filter = `${filter} sepia(1) saturate(6) hue-rotate(150deg)`;
    ctx.drawImage(video, -W / 2 + split, -H / 2, W, H);
  }
  const glow = n(s.glow, 0, 0, 1);
  if (glow > 0) {
    ctx.globalCompositeOperation = "screen";
    ctx.globalAlpha = glow * 0.5;
    ctx.filter = `${filter} blur(${12 * glow}px) brightness(1.2)`;
    ctx.drawImage(video, -W / 2, -H / 2, W, H);
  }
  ctx.restore();

  ctx.save();
  const tint = typeof s.tint === "string" && s.tint !== "none" ? s.tint : null;
  if (tint) {
    ctx.globalCompositeOperation = "soft-light";
    ctx.globalAlpha = n(s.tintStrength, 0.3, 0, 0.8);
    ctx.fillStyle = tint;
    ctx.fillRect(0, 0, W, H);
  }
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = 1;
  const vig = n(s.vignette, 0, 0, 1);
  if (vig > 0) {
    const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.75);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, `rgba(0,0,0,${vig * 0.85})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
  const grain = n(s.grain, 0, 0, 1);
  if (grain > 0 && grainPattern) {
    ctx.globalAlpha = grain * 0.1;
    ctx.fillStyle = grainPattern;
    ctx.save();
    ctx.translate(-Math.floor(Math.random() * GRAIN_TILE), -Math.floor(Math.random() * GRAIN_TILE));
    ctx.fillRect(0, 0, W + GRAIN_TILE, H + GRAIN_TILE);
    ctx.restore();
    ctx.globalAlpha = 1;
  }
  const flash = n(s.flash, 0, 0, 1);
  if (flash > 0 && beat < 0.08) {
    ctx.globalAlpha = flash * 0.7 * (1 - beat / 0.08);
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 1;
  }
  const bars = n(s.letterbox, 0, 0, 0.2) * H;
  if (bars > 0) {
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, bars);
    ctx.fillRect(0, H - bars, W, bars);
  }
  ctx.restore();
}

export function VideoEditor({ src, style }: { src: string; style: VideoStyle }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [exporting, setExporting] = useState(false);
  const [pos, setPos] = useState({ t: 0, d: 0 });
  const [media, setMedia] = useState({ playing: false, muted: false, volume: 1, rate: 1 });
  const [menu, setMenu] = useState(false);
  const [compare, setCompare] = useState(false);
  const [download, setDownload] = useState<{ url: string; ext: string } | null>(null);
  const dirtyRef = useRef(true);
  const compareRef = useRef(false);
  const styleRef = useRef(style);
  styleRef.current = style;

  useEffect(() => {
    const v = videoRef.current!;
    const c = canvasRef.current!;
    const ctx = c.getContext("2d")!;
    let raf = 0;
    let lastDraw = 0;

    // One pre-rendered noise tile reused as a pattern: replaces the old
    // per-frame loop of 600 random rectangles with a single fill.
    const tile = document.createElement("canvas");
    tile.width = GRAIN_TILE;
    tile.height = GRAIN_TILE;
    const tctx = tile.getContext("2d");
    if (tctx) {
      const img = tctx.createImageData(GRAIN_TILE, GRAIN_TILE);
      for (let i = 0; i < img.data.length; i += 4) {
        const val = Math.random() > 0.5 ? 255 : 0;
        img.data[i] = val;
        img.data[i + 1] = val;
        img.data[i + 2] = val;
        img.data[i + 3] = 255;
      }
      tctx.putImageData(img, 0, 0);
    }
    const grainPat = ctx.createPattern(tile, "repeat");
    const render = () => drawFrame(ctx, v, compareRef.current ? {} : styleRef.current, v.currentTime, grainPat);

    const onMeta = () => {
      const k = Math.min(1, 1080 / Math.max(v.videoWidth, v.videoHeight));
      c.width = Math.round(v.videoWidth * k);
      c.height = Math.round(v.videoHeight * k);
      dirtyRef.current = true;
      setPos({ t: v.currentTime, d: isFinite(v.duration) ? v.duration : 0 });
      setMedia({ playing: !v.paused, muted: v.muted, volume: v.volume, rate: v.playbackRate });
    };
    const sync = () =>
      setMedia({ playing: !v.paused, muted: v.muted, volume: v.volume, rate: v.playbackRate });
    const markDirty = () => {
      dirtyRef.current = true;
    };
    v.addEventListener("loadedmetadata", onMeta);
    v.addEventListener("loadeddata", markDirty);
    v.addEventListener("seeked", markDirty);
    v.addEventListener("play", sync);
    v.addEventListener("pause", sync);
    v.addEventListener("volumechange", sync);
    v.addEventListener("ratechange", sync);
    const loop = () => {
      if (v.readyState >= 2) {
        const now = performance.now();
        // Draw on demand while paused, and cap live drawing to ~30fps to match
        // the export capture rate: half the canvas work, same visible result.
        if (dirtyRef.current || (!v.paused && now - lastDraw >= 1000 / 31)) {
          render();
          dirtyRef.current = false;
          lastDraw = now;
        }
      }
      if (v.duration) {
        const d = isFinite(v.duration) ? v.duration : 0;
        setPos((p) =>
          Math.abs(p.t - v.currentTime) >= 0.05 || Math.abs(p.d - d) >= 0.05
            ? { t: v.currentTime, d }
            : p,
        );
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      v.removeEventListener("loadedmetadata", onMeta);
      v.removeEventListener("loadeddata", markDirty);
      v.removeEventListener("seeked", markDirty);
      v.removeEventListener("play", sync);
      v.removeEventListener("pause", sync);
      v.removeEventListener("volumechange", sync);
      v.removeEventListener("ratechange", sync);
    };
  }, [src]);

  useEffect(() => {
    if (videoRef.current) videoRef.current.playbackRate = n(style.speed, 1, 0.25, 2);
    dirtyRef.current = true;
    setDownload(null);
  }, [style]);

  // Sync the compare flag to the render loop only after React commits it, then
  // force a fresh frame so a paused preview always shows the right version.
  useEffect(() => {
    compareRef.current = compare;
    dirtyRef.current = true;
  }, [compare]);

  const exportVideo = async () => {
    const v = videoRef.current!;
    const c = canvasRef.current!;
    setExporting(true);
    setDownload(null);
    const stream = c.captureStream(30);
    try {
      const ac = new AudioContext();
      const srcNode = ac.createMediaElementSource(v);
      const dest = ac.createMediaStreamDestination();
      srcNode.connect(dest);
      srcNode.connect(ac.destination);
      dest.stream.getAudioTracks().forEach((t) => stream.addTrack(t));
    } catch {
      // audio already connected or unavailable
    }
    const mime = ["video/mp4", "video/webm;codecs=vp9,opus", "video/webm"].find((m) => MediaRecorder.isTypeSupported(m)) ?? "";
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 8_000_000 } : undefined);
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const done = new Promise<void>((r) => (rec.onstop = () => r()));
    v.loop = false;
    v.currentTime = 0;
    await v.play();
    rec.start(250);
    await new Promise<void>((r) => (v.onended = () => r()));
    rec.stop();
    await done;
    v.loop = true;
    v.pause();
    const type = rec.mimeType || "video/webm";
    setDownload({ url: URL.createObjectURL(new Blob(chunks, { type })), ext: type.includes("mp4") ? "mp4" : "webm" });
    setExporting(false);
  };

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v || exporting) return;
    if (v.paused) v.play().catch(() => {});
    else v.pause();
  };

  const toggleFullscreen = () => {
    const w = wrapRef.current;
    if (!w) return;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else w.requestFullscreen?.().catch(() => {});
  };

  return (
    <div>
      <div ref={wrapRef} className="overflow-hidden rounded-[var(--radius)] border border-border bg-black">
        <video ref={videoRef} src={src} loop playsInline crossOrigin="anonymous" className="hidden" />
        <canvas ref={canvasRef} className="mx-auto block max-h-[60vh] w-full bg-black object-contain" />

        {/* Native-style player controls */}
        <div className="relative bg-black px-3 pb-2 pt-1.5 text-white">
          <input
            type="range"
            min={0}
            max={pos.d || 1}
            step={0.01}
            value={Math.min(pos.t, pos.d || 0)}
            onChange={(e) => {
              const v = videoRef.current;
              if (v && isFinite(v.duration)) v.currentTime = Number(e.target.value);
            }}
            disabled={exporting}
            aria-label="Seek"
            className="block h-1 w-full cursor-pointer accent-white disabled:opacity-50"
          />
          <div className="mt-2 flex items-center gap-3">
            <button
              type="button"
              onClick={togglePlay}
              disabled={exporting}
              aria-label={media.playing ? "Pause" : "Play"}
              className="text-white/90 transition hover:text-white disabled:opacity-50"
            >
              {media.playing ? (
                <svg viewBox="0 0 24 24" fill="currentColor" className="size-5">
                  <rect x="6" y="4" width="4" height="16" rx="1" />
                  <rect x="14" y="4" width="4" height="16" rx="1" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="currentColor" className="size-5">
                  <path d="M7 4.5v15l13-7.5z" />
                </svg>
              )}
            </button>
            <span className="text-xs tabular-nums text-white/80">
              {fmt(pos.t)} / {fmt(pos.d)}
            </span>

            <div className="ml-auto flex items-center gap-3">
              <div className="group flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    const v = videoRef.current;
                    if (v) v.muted = !v.muted;
                  }}
                  aria-label={media.muted ? "Unmute" : "Mute"}
                  className="text-white/90 transition hover:text-white"
                >
                  {media.muted || media.volume === 0 ? (
                    <svg viewBox="0 0 24 24" className="size-5">
                      <path fill="currentColor" d="M3 9v6h4l5 4V5L7 9H3z" />
                      <path fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" d="m16 9 5 6M21 9l-5 6" />
                    </svg>
                  ) : (
                    <svg viewBox="0 0 24 24" className="size-5">
                      <path fill="currentColor" d="M3 9v6h4l5 4V5L7 9H3z" />
                      <path fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" d="M16 9a4 4 0 0 1 0 6" />
                      <path fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" d="M18.5 6.5a8 8 0 0 1 0 11" />
                    </svg>
                  )}
                </button>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={media.muted ? 0 : media.volume}
                  onChange={(e) => {
                    const v = videoRef.current;
                    if (!v) return;
                    const val = Number(e.target.value);
                    v.volume = val;
                    v.muted = val === 0;
                  }}
                  aria-label="Volume"
                  className="h-1 w-0 cursor-pointer accent-white transition-all duration-200 group-hover:w-16 focus:w-16"
                />
              </div>
              <button
                type="button"
                onClick={toggleFullscreen}
                aria-label="Fullscreen"
                className="text-white/90 transition hover:text-white"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-5">
                  <path d="M8 3H5a2 2 0 0 0-2 2v3" />
                  <path d="M21 8V5a2 2 0 0 0-2-2h-3" />
                  <path d="M3 16v3a2 2 0 0 0 2 2h3" />
                  <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
                </svg>
              </button>
              <button
                type="button"
                onClick={() => setMenu((m) => !m)}
                aria-label="Playback options"
                className="text-white/90 transition hover:text-white"
              >
                <svg viewBox="0 0 24 24" fill="currentColor" className="size-5">
                  <circle cx="12" cy="5" r="1.6" />
                  <circle cx="12" cy="12" r="1.6" />
                  <circle cx="12" cy="19" r="1.6" />
                </svg>
              </button>
            </div>

            {menu && (
              <>
                <button
                  type="button"
                  aria-label="Close menu"
                  onClick={() => setMenu(false)}
                  className="fixed inset-0 z-10 cursor-default"
                />
                <div className="absolute bottom-10 right-3 z-20 w-28 overflow-hidden rounded-md border border-white/15 bg-black py-1">
                  <p className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-white/50">
                    Speed
                  </p>
                  {[0.5, 1, 1.5, 2].map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => {
                        const v = videoRef.current;
                        if (v) v.playbackRate = s;
                        setMenu(false);
                      }}
                      className={`flex w-full items-center justify-between px-3 py-1.5 text-xs transition hover:bg-white/10 ${
                        media.rate === s ? "text-white" : "text-white/60"
                      }`}
                    >
                      <span>{s}×</span>
                      {media.rate === s && <span>✓</span>}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-4">
        <button
          type="button"
          onClick={() => setCompare((c) => !c)}
          disabled={exporting}
          aria-pressed={compare}
          className={`rounded-full border px-4 py-2 text-sm font-semibold transition disabled:opacity-50 ${
            compare
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border bg-secondary text-secondary-foreground hover:bg-muted"
          }`}
        >
          {compare ? "Show my edit" : "Show original"}
        </button>
        <button
          onClick={exportVideo}
          disabled={exporting}
          className="rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:brightness-110 disabled:opacity-50"
        >
          {exporting ? "Saving video… (plays once)" : "Save edited video"}
        </button>
        {download && (
          <a href={download.url} download={`cutline-edit.${download.ext}`} className="text-sm font-semibold text-primary hover:underline">
            Download video
          </a>
        )}
      </div>
    </div>
  );
}
