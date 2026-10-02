export type Motion = { t: number; s: number };
export type Analysis = { bpm: number; offset: number; dur: number; motion: Motion[] };
export type Cut = { start: number };
export type Plan = { cuts: Cut[]; len: number };

async function beats(src: string) {
  try {
    const buf = await (await fetch(src)).arrayBuffer();
    const ac = new AudioContext();
    const audio = await ac.decodeAudioData(buf.slice(0));
    ac.close();
    const d = audio.getChannelData(0);
    const hop = Math.floor(audio.sampleRate / 100);
    const env: number[] = [];
    let prev = 0;
    for (let i = 0; i + hop < d.length; i += hop) {
      let e = 0;
      for (let j = 0; j < hop; j += 4) e += d[i + j] * d[i + j];
      env.push(Math.max(0, e - prev));
      prev = e;
    }
    let lag = 50;
    let best = -1;
    for (let l = 30; l <= 100; l++) {
      let s = 0;
      for (let i = l; i < env.length; i++) s += env[i] * env[i - l];
      if (s > best) ((best = s), (lag = l));
    }
    let off = 0;
    let os = -1;
    for (let o = 0; o < lag; o++) {
      let s = 0;
      for (let i = o; i < env.length; i += lag) s += env[i];
      if (s > os) ((os = s), (off = o));
    }
    let bpm = 6000 / lag;
    while (bpm < 100) bpm *= 2;
    while (bpm > 170) bpm /= 2;
    return { bpm, offset: off / 100 };
  } catch {
    return { bpm: 128, offset: 0 };
  }
}

async function motion(src: string): Promise<{ dur: number; motion: Motion[] }> {
  const v = document.createElement("video");
  v.muted = true;
  v.src = src;
  await new Promise<void>((r) => (v.onloadeddata = () => r()));
  const dur = v.duration || 10;
  const seek = (t: number) =>
    new Promise<void>((r) => {
      v.onseeked = () => r();
      v.currentTime = t;
    });
  const c = document.createElement("canvas");
  c.width = 48;
  c.height = 27;
  const x = c.getContext("2d", { willReadFrequently: true })!;
  const step = Math.max(0.4, dur / 80);
  const out: Motion[] = [];
  let prev: Uint8ClampedArray | null = null;
  for (let t = 0; t < dur - 0.1; t += step) {
    await seek(t);
    x.drawImage(v, 0, 0, 48, 27);
    const d = x.getImageData(0, 0, 48, 27).data;
    let s = 0;
    if (prev) for (let i = 0; i < d.length; i += 4) s += Math.abs(d[i] - prev[i]) + Math.abs(d[i + 1] - prev[i + 1]);
    prev = d;
    out.push({ t, s });
  }
  return { dur, motion: out };
}

export async function analyze(src: string): Promise<Analysis> {
  const [b, m] = await Promise.all([beats(src), motion(src)]);
  return { ...b, ...m };
}

// pick the most action-packed moments and cut them to the beat
export function planCuts(a: Analysis, beatsPerCut: number): Plan {
  const len = (60 / a.bpm) * beatsPerCut;
  const n = Math.max(2, Math.floor(Math.min(a.dur, 30) / len));
  const slots = a.motion.filter((p) => p.t + len <= a.dur).sort((x, y) => y.s - x.s);
  const picked: number[] = [];
  for (const p of slots) {
    if (picked.length >= n) break;
    if (picked.every((q) => Math.abs(q - p.t) >= len)) picked.push(p.t);
  }
  if (!picked.length) picked.push(0);
  picked.sort((x, y) => x - y);
  return { cuts: picked.map((start) => ({ start })), len };
}
