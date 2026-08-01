/** Tiny WebAudio point-sound engine. Silent when disabled. */
let ctx: AudioContext | null = null;
let enabled = true;

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const AC =
      (
        window as unknown as {
          AudioContext?: typeof AudioContext;
          webkitAudioContext?: typeof AudioContext;
        }
      ).AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

function beep(freq: number, dur = 0.09, gain = 0.06, type: OscillatorType = "sine", delay = 0) {
  if (!enabled) return;
  const c = getCtx();
  if (!c) return;
  const now = c.currentTime + delay;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, now);
  g.gain.setValueAtTime(0, now);
  g.gain.linearRampToValueAtTime(gain, now + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
  osc.connect(g).connect(c.destination);
  osc.start(now);
  osc.stop(now + dur + 0.02);
}

export const sfx = {
  setEnabled(on: boolean) {
    enabled = on;
  },
  point() {
    beep(880, 0.08, 0.05, "triangle");
  },
  gamePoint() {
    beep(660, 0.09, 0.06, "sine");
    beep(990, 0.12, 0.06, "sine", 0.09);
  },
  matchWin() {
    beep(523, 0.12, 0.07, "triangle");
    beep(659, 0.12, 0.07, "triangle", 0.12);
    beep(784, 0.18, 0.08, "triangle", 0.24);
    beep(1046, 0.24, 0.08, "sine", 0.4);
  },
  fault() {
    beep(220, 0.16, 0.06, "sawtooth");
  },
  tick() {
    beep(1200, 0.02, 0.02, "square");
  },
};
