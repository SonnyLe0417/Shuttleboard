/** Web Speech API wrapper for hands-free scoring. Chromium/Safari only. */
type Cmd =
  | { type: "point"; team: 0 | 1 }
  | { type: "fault"; team: 0 | 1 }
  | { type: "undo" }
  | { type: "reset" }
  | { type: "unknown"; heard: string };

export type VoiceListener = (cmd: Cmd) => void;

interface SpeechRecognitionResultItem {
  transcript: string;
  confidence: number;
}
interface SpeechRecognitionResult {
  0: SpeechRecognitionResultItem;
  isFinal: boolean;
  length: number;
}
interface SpeechRecognitionEvent extends Event {
  resultIndex: number;
  results: {
    length: number;
    [index: number]: SpeechRecognitionResult;
  };
}
interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((e: SpeechRecognitionEvent) => void) | null;
  onerror: ((e: Event) => void) | null;
  onend: (() => void) | null;
}
type Ctor = new () => SpeechRecognitionLike;

function getRecognitionCtor(): Ctor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: Ctor; webkitSpeechRecognition?: Ctor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function voiceSupported(): boolean {
  return getRecognitionCtor() !== null;
}

function parse(text: string, namesLower: [string, string]): Cmd {
  const t = text.toLowerCase().trim();
  if (/\bundo\b|\btake back\b|\brewind\b/.test(t)) return { type: "undo" };
  if (/\breset\b|\bnew match\b|\bclear\b/.test(t)) return { type: "reset" };
  const isA =
    /\b(point\s+a|team\s+a|a\s+point|score\s+a|a\s+scores)\b/.test(t) ||
    (namesLower[0] && t.includes(namesLower[0]) && !t.includes(namesLower[1]));
  const isB =
    /\b(point\s+b|team\s+b|b\s+point|score\s+b|b\s+scores)\b/.test(t) ||
    (namesLower[1] && t.includes(namesLower[1]) && !t.includes(namesLower[0]));
  const fault = /\bfault\b|\bfoul\b|\bout\b/.test(t);
  if (isA && fault) return { type: "fault", team: 0 };
  if (isB && fault) return { type: "fault", team: 1 };
  if (isA) return { type: "point", team: 0 };
  if (isB) return { type: "point", team: 1 };
  return { type: "unknown", heard: text };
}

export function createVoiceController(getNames: () => [string, string]) {
  const Ctor = getRecognitionCtor();
  let rec: SpeechRecognitionLike | null = null;
  let running = false;
  let listener: VoiceListener | null = null;
  let stopping = false;

  const start = () => {
    if (!Ctor || running) return;
    rec = new Ctor();
    rec.lang = "en-US";
    rec.interimResults = false;
    rec.continuous = true;
    rec.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (!r.isFinal) continue;
        const heard = r[0].transcript;
        const names = getNames();
        const cmd = parse(heard, [names[0].toLowerCase(), names[1].toLowerCase()]);
        listener?.(cmd);
      }
    };
    rec.onerror = () => {};
    rec.onend = () => {
      running = false;
      if (!stopping) {
        try {
          rec?.start();
          running = true;
        } catch {
          /* no-op */
        }
      }
    };
    try {
      rec.start();
      running = true;
      stopping = false;
    } catch {
      running = false;
    }
  };

  const stop = () => {
    stopping = true;
    running = false;
    try {
      rec?.stop();
    } catch {
      /* no-op */
    }
    rec = null;
  };

  return {
    start,
    stop,
    isRunning: () => running,
    setListener: (l: VoiceListener) => {
      listener = l;
    },
  };
}
