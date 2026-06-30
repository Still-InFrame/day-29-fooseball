// Synthesized sound effects via WebAudio — no audio files to ship.
// AudioContext must be created/resumed after a user gesture (we call unlock()
// from the "Start"/"Ready" button), or browsers will keep it suspended.

let ctx: AudioContext | null = null;
let enabled = true;

function ac(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  return ctx;
}

export function unlock() {
  const c = ac();
  if (c && c.state === "suspended") void c.resume();
}

export function setMuted(m: boolean) {
  enabled = !m;
}

function blip(freq: number, dur: number, type: OscillatorType, gain = 0.2, slideTo?: number) {
  if (!enabled) return;
  const c = ac();
  if (!c) return;
  const t = c.currentTime;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(c.destination);
  osc.start(t);
  osc.stop(t + dur);
}

// Solid "thunk" when a man strikes the ball.
export function thunk() {
  blip(150, 0.09, "square", 0.18, 90);
}

// Light tick off a wall.
export function wall() {
  blip(420, 0.05, "triangle", 0.08);
}

// Rising arpeggio + a little noise cheer on a goal.
export function goal() {
  if (!enabled) return;
  const c = ac();
  if (!c) return;
  const notes = [523, 659, 784, 1046];
  notes.forEach((f, i) => {
    setTimeout(() => blip(f, 0.16, "square", 0.16), i * 70);
  });
  // Crowd-ish noise burst.
  const t = c.currentTime;
  const buf = c.createBuffer(1, c.sampleRate * 0.5, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
  const src = c.createBufferSource();
  const g = c.createGain();
  g.gain.setValueAtTime(0.12, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
  const filt = c.createBiquadFilter();
  filt.type = "bandpass";
  filt.frequency.value = 1200;
  src.buffer = buf;
  src.connect(filt).connect(g).connect(c.destination);
  src.start(t);
}

// Low rattling thud when the table is shaken.
export function rattle() {
  if (!enabled) return;
  const c = ac();
  if (!c) return;
  const t = c.currentTime;
  blip(95, 0.13, "square", 0.16, 55);
  const buf = c.createBuffer(1, Math.floor(c.sampleRate * 0.13), c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  const src = c.createBufferSource();
  const g = c.createGain();
  const f = c.createBiquadFilter();
  f.type = "lowpass";
  f.frequency.value = 420;
  g.gain.setValueAtTime(0.15, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.13);
  src.buffer = buf;
  src.connect(f).connect(g).connect(c.destination);
  src.start(t);
}

// Triumphant little fanfare on match win.
export function fanfare() {
  [523, 659, 784, 1046, 1318].forEach((f, i) => {
    setTimeout(() => blip(f, 0.22, "square", 0.18), i * 110);
  });
}
