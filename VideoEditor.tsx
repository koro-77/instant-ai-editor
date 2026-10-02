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
  bpm?: number;
  glitch?: number;
  invert?: number;
  speedRamp?: number;
  vertical?: number;
};

const n = (v: unknown, d: number, lo: number, hi: number) => {
  const x = typeof v === "number" && isFinite(v) ? v : d;
  return Math.min(hi, Math.max(lo, x));
};

export const PRESETS: Record<string, VideoStyle> = {
  "Hard style": { name: "Hard style", bpm: 150, brightness: 1.05, contrast: 1.4, saturate: 1.5, shake: 0.5, zoomPulse: 0.16, flash: 0.6, invert: 0.5, rgbSplit: 6, glitch: 0.4, grain: 0.3, vignette: 0.5, speedRamp: 0.5, vertical: 1 },
  "Anime AMV": { name: "Anime AMV", bpm: 128, brightness: 1.1, contrast: 1.25, saturate: 1.8, glow: 0.55, tint: "#ff4fd8", tintStrength: 0.25, zoomPulse: 0.12, flash: 0.5, rgbSplit: 4, speedRamp: 0.35, vertical: 1 },
  "Football edit": { name: "Football edit", bpm: 140, brightness: 0.95, contrast: 1.35, saturate: 1.4, tint: "#ffb347", tintStrength: 0.2, vignette: 0.6, shake: 0.35, zoomPulse: 0.14, speedRamp: 0.7, glow: 0.25, grain: 0.2, vertical: 1 },
  Shorts: { name: "Shorts", bpm: 120, saturate: 1.3, contrast: 1.15, zoomPulse: 0.1, flash: 0.3, vertical: 1 },
};

function drawFrame(ctx: CanvasRenderingContext2D, video: HTMLVideoElement, s: VideoStyle, t: number) {
  const { width: W, height: H } = ctx.canvas;
  const filter = `brightness(${n(s.brightness, 1, 0.3, 2)}) contrast(${n(s.contrast, 1, 0.3, 2.5)}) saturate(${n(s.saturate, 1, 0, 3)}) hue-rotate(${n(s.hue, 0, -180, 180)}deg) sepia(${n(s.sepia, 0, 0, 1)}) grayscale(${n(s.grayscale, 0, 0, 1)}) blur(${n(s.blur, 0, 0, 6)}px)`;
  const beat = ((t * n(s.bpm, 120, 60, 200)) / 60) % 1;
  const punch = n(s.zoomPulse, 0, 0, 0.3) * Math.max(0, 1 - beat * 4);
  const shake = n(s.shake, 0, 0, 1) * W * 0.03;
  const dx = shake ? (Math.sin(t * 47) + Math.sin(t * 31)) * shake * 0.5 : 0;
  const dy = shake ? (Math.cos(t * 41) + Math.sin(t * 23)) * shake * 0.5 : 0;
  const scale = 1 + punch + (shake ? 0.06 : 0);
  const vw = video.videoWidth || W;
  const vh = video.videoHeight || H;
  const kk = Math.max(W / vw, H / vh);
  const sw = W / kk;
  const sh = H / kk;
  const put = (ox = 0) => ctx.drawImage(video, (vw - sw) / 2, (vh - sh) / 2, sw, sh, -W / 2 + ox, -H / 2, W, H);

  ctx.save();
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, W, H);
  ctx.translate(W / 2 + dx, H / 2 + dy);
  ctx.scale(scale, scale);
  ctx.filter = filter;
  put();
  const split = n(s.rgbSplit, 0, 0, 20);
  if (split > 0.5) {
    ctx.globalCompositeOperation = "screen";
    ctx.globalAlpha = 0.35;
    ctx.filter = `${filter} sepia(1) saturate(6) hue-rotate(-50deg)`;
    put(-split);
    ctx.filter = `${filter} sepia(1) saturate(6) hue-rotate(150deg)`;
    put(split);
  }
  const glow = n(s.glow, 0, 0, 1);
  if (glow > 0) {
    ctx.globalCompositeOperation = "screen";
    ctx.globalAlpha = glow * 0.5;
    ctx.filter = `${filter} blur(${12 * glow}px) brightness(1.2)`;
    put();
  }
  ctx.restore();

  ctx.save();
  const glitch = n(s.glitch, 0, 0, 1);
  if (glitch > 0 && Math.random() < glitch * 0.4) {
    for (let i = 0; i < 3; i++) {
      const y = Math.random() * H;
      const hh = H * (0.02 + Math.random() * 0.06);
      ctx.drawImage(ctx.canvas, 0, y, W, hh, (Math.random() - 0.5) * W * 0.12 * glitch, y, W, hh);
    }
  }
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
  if (grain > 0) {
    ctx.globalAlpha = grain * 0.12;
    for (let i = 0; i < 600; i++) {
      ctx.fillStyle = Math.random() > 0.5 ? "#fff" : "#000";
      ctx.fillRect(Math.random() * W, Math.random() * H, 2, 2);
    }
    ctx.globalAlpha = 1;
  }
  const flash = n(s.flash, 0, 0, 1);
  if (flash > 0 && beat < 0.08) {
    ctx.globalAlpha = flash * 0.7 * (1 - beat / 0.08);
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 1;
  }
  const inv = n(s.invert, 0, 0, 1);
  if (inv > 0 && beat > 0.5 && beat < 0.56) {
    ctx.globalCompositeOperation = "difference";
    ctx.globalAlpha = inv;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = "source-over";
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
  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [download, setDownload] = useState<{ url: string; ext: string } | null>(null);
  const styleRef = useRef(style);
  styleRef.current = style;

  useEffect(() => {
    const v = videoRef.current!;
    const c = canvasRef.current!;
    const ctx = c.getContext("2d")!;
    let raf = 0;
    const onMeta = () => {
      v.play().catch(() => {});
    };
    v.addEventListener("loadedmetadata", onMeta);
    const loop = () => {
      const st = styleRef.current;
      if (v.videoWidth) {
        const vert = n(st.vertical, 0, 0, 1) > 0.5;
        const k = Math.min(1, 1080 / Math.max(v.videoWidth, v.videoHeight));
        const w = vert ? 720 : Math.round(v.videoWidth * k);
        const h = vert ? 1280 : Math.round(v.videoHeight * k);
        if (c.width !== w || c.height !== h) {
          c.width = w;
          c.height = h;
        }
        const ramp = n(st.speedRamp, 0, 0, 1);
        const ph = ((v.currentTime * n(st.bpm, 120, 60, 200)) / 60) % 1;
        const rate = n(st.speed, 1, 0.25, 2) * (ramp > 0 ? (ph < 0.6 ? 1 - 0.7 * ramp : 1 + 0.8 * ramp) : 1);
        if (Math.abs(v.playbackRate - rate) > 0.01) v.playbackRate = rate;
      }
      if (v.readyState >= 2) drawFrame(ctx, v, st, v.currentTime);
      if (v.duration) setProgress(v.currentTime / v.duration);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      v.removeEventListener("loadedmetadata", onMeta);
    };
  }, [src]);

  useEffect(() => {
    setDownload(null);
  }, [style]);

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
    v.play().catch(() => {});
    const type = rec.mimeType || "video/webm";
    setDownload({ url: URL.createObjectURL(new Blob(chunks, { type })), ext: type.includes("mp4") ? "mp4" : "webm" });
    setExporting(false);
  };

  return (
    <div>
      <video ref={videoRef} src={src} loop playsInline crossOrigin="anonymous" className="hidden" />
      <canvas ref={canvasRef} className="mx-auto max-h-[60vh] w-full rounded-[var(--radius)] bg-muted object-contain" />
      <div className="mt-2 h-1 overflow-hidden rounded-full bg-muted">
        <div className="h-full bg-primary" style={{ width: `${progress * 100}%` }} />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-4">
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
