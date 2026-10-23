export type ThemeId = "club" | "court-neon" | "ember" | "paper" | "emerald" | "indigo";
export type ColorMode = "light" | "dark";
export type TextScale = "normal" | "large" | "xlarge";

export const THEMES: {
  id: ThemeId;
  name: string;
  tagline: string;
  swatches: string[];
  mode: "dark" | "light";
}[] = [
  {
    id: "club",
    name: "Sports Club",
    tagline: "Warm white · court green",
    swatches: ["#F7F7F2", "#18221D", "#176348"],
    mode: "light",
  },
  {
    id: "court-neon",
    name: "Court Neon",
    tagline: "Deep navy · electric mint",
    swatches: ["#0d1b2a", "#1b4332", "#2dd4a8", "#73ffb8"],
    mode: "dark",
  },
  {
    id: "ember",
    name: "Stadium Ember",
    tagline: "Charcoal · warm ember",
    swatches: ["#1a1a1a", "#2d2d2d", "#4a4a4a", "#e85d3a"],
    mode: "dark",
  },
  {
    id: "emerald",
    name: "Emerald Prestige",
    tagline: "Rich emerald · gold",
    swatches: ["#064e3b", "#0d7a5f", "#c9a84c", "#f5f0e0"],
    mode: "dark",
  },
  {
    id: "indigo",
    name: "Midnight Indigo",
    tagline: "Deep navy · electric indigo",
    swatches: ["#0a0a1a", "#141432", "#1e1e5a", "#4f46e5"],
    mode: "dark",
  },
  {
    id: "paper",
    name: "Paper & Ink",
    tagline: "Light · minimal editorial",
    swatches: ["#fafaf7", "#e8e4dd", "#2d2d2d", "#0d0d0d"],
    mode: "light",
  },
];

const STORAGE_KEY = "shuttleboard-theme";
const MODE_KEY = "shuttleboard-mode";
const HC_KEY = "shuttleboard-high-contrast";
const RM_KEY = "shuttleboard-reduced-motion";
const ACCENT_KEY = "shuttleboard-accent";
const SOUND_KEY = "shuttleboard-sound";
const HAPTICS_KEY = "shuttleboard-haptics";
const VOICE_KEY = "shuttleboard-voice";
const TEXT_SCALE_KEY = "shuttleboard-text-scale";
const COLOR_BLIND_KEY = "shuttleboard-color-blind";
const DEFAULT: ThemeId = "club";

export type A11yPrefs = {
  mode: ColorMode;
  highContrast: boolean;
  reducedMotion: boolean;
  accent: string | null; // hex like "#2dd4a8" or null to use theme default
  sound: boolean;
  haptics: boolean;
  voice: boolean;
  textScale: TextScale;
  colorBlindPalette: boolean;
};

export function getStoredTheme(): ThemeId {
  if (typeof window === "undefined") return DEFAULT;
  const v = window.localStorage.getItem(STORAGE_KEY) as ThemeId | null;
  return v && THEMES.some((t) => t.id === v) ? v : DEFAULT;
}

export function getStoredPrefs(): A11yPrefs {
  if (typeof window === "undefined") {
    return {
      mode: "light",
      highContrast: false,
      reducedMotion: false,
      accent: null,
      sound: true,
      haptics: true,
      voice: false,
      textScale: "normal",
      colorBlindPalette: false,
    };
  }
  const mode =
    (window.localStorage.getItem(MODE_KEY) as ColorMode | null) ??
    (window.localStorage.getItem(STORAGE_KEY) ? "dark" : "light");
  const accent = window.localStorage.getItem(ACCENT_KEY);
  const readBool = (k: string, def: boolean) => {
    const v = window.localStorage.getItem(k);
    if (v === null) return def;
    return v === "1";
  };
  return {
    mode: mode === "light" ? "light" : "dark",
    highContrast: window.localStorage.getItem(HC_KEY) === "1",
    reducedMotion: window.localStorage.getItem(RM_KEY) === "1",
    accent: accent && /^#[0-9a-fA-F]{6}$/.test(accent) ? accent : null,
    sound: readBool(SOUND_KEY, true),
    haptics: readBool(HAPTICS_KEY, true),
    voice: readBool(VOICE_KEY, false),
    textScale: ((window.localStorage.getItem(TEXT_SCALE_KEY) as TextScale | null) ??
      "normal") as TextScale,
    colorBlindPalette: readBool(COLOR_BLIND_KEY, false),
  };
}

/* ---- color helpers: hex -> oklch ---- */
function hexToRgb(hex: string) {
  const h = hex.replace("#", "");
  return {
    r: parseInt(h.slice(0, 2), 16) / 255,
    g: parseInt(h.slice(2, 4), 16) / 255,
    b: parseInt(h.slice(4, 6), 16) / 255,
  };
}
function srgbToLinear(c: number) {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
function hexToOklch(hex: string) {
  const { r, g, b } = hexToRgb(hex);
  const lr = srgbToLinear(r),
    lg = srgbToLinear(g),
    lb = srgbToLinear(b);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const C = Math.sqrt(A * A + B * B);
  let H = (Math.atan2(B, A) * 180) / Math.PI;
  if (H < 0) H += 360;
  return { L, C, H };
}
function luminance(hex: string) {
  const { r, g, b } = hexToRgb(hex);
  const lr = srgbToLinear(r),
    lg = srgbToLinear(g),
    lb = srgbToLinear(b);
  return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
}

function applyAccent(hex: string | null) {
  const root = document.documentElement;
  if (!hex) {
    root.style.removeProperty("--primary");
    root.style.removeProperty("--primary-foreground");
    root.style.removeProperty("--primary-glow");
    root.style.removeProperty("--ring");
    root.style.removeProperty("--court-line");
    root.style.removeProperty("--in");
    root.style.removeProperty("--in-foreground");
    root.style.removeProperty("--gradient-primary");
    return;
  }
  const { L, C, H } = hexToOklch(hex);
  const primary = `oklch(${L.toFixed(3)} ${C.toFixed(3)} ${H.toFixed(1)})`;
  const glowL = Math.min(0.95, L + 0.08);
  const glow = `oklch(${glowL.toFixed(3)} ${C.toFixed(3)} ${H.toFixed(1)})`;
  const fg = luminance(hex) > 0.55 ? "oklch(0.16 0.03 250)" : "oklch(0.98 0.005 90)";
  root.style.setProperty("--primary", primary);
  root.style.setProperty("--primary-glow", glow);
  root.style.setProperty("--primary-foreground", fg);
  root.style.setProperty("--ring", primary);
  root.style.setProperty("--court-line", glow);
  root.style.setProperty("--in", primary);
  root.style.setProperty("--in-foreground", fg);
  root.style.setProperty("--gradient-primary", `linear-gradient(135deg, ${primary}, ${glow})`);
}

function applyPrefs(prefs: A11yPrefs) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.classList.toggle("hc", prefs.highContrast);
  root.classList.toggle("rm", prefs.reducedMotion);
  root.dataset.textScale = prefs.textScale;
  root.dataset.colorBlind = prefs.colorBlindPalette ? "true" : "false";
  applyAccent(prefs.accent);
  // Broadcast side-channel prefs consumed by audio/haptics/voice modules
  const w = window as unknown as {
    __sbSound?: boolean;
    __sbHaptics?: boolean;
    __sbVoice?: boolean;
  };
  w.__sbSound = prefs.sound;
  w.__sbHaptics = prefs.haptics;
  w.__sbVoice = prefs.voice;
  window.dispatchEvent(new CustomEvent("sb-prefs-change", { detail: prefs }));
}

export function setTextScale(textScale: TextScale) {
  if (typeof window !== "undefined") window.localStorage.setItem(TEXT_SCALE_KEY, textScale);
  applyTheme(getStoredTheme());
}

export function setColorBlindPalette(on: boolean) {
  if (typeof window !== "undefined") window.localStorage.setItem(COLOR_BLIND_KEY, on ? "1" : "0");
  applyTheme(getStoredTheme());
}

/** Hydrate device settings from the authenticated account without replacing unrelated values. */
export function syncAccessibilityPrefs(prefs: Partial<A11yPrefs>) {
  if (prefs.textScale !== undefined) setTextScale(prefs.textScale);
  if (prefs.colorBlindPalette !== undefined) setColorBlindPalette(prefs.colorBlindPalette);
  if (prefs.highContrast !== undefined) setHighContrast(prefs.highContrast);
  if (prefs.reducedMotion !== undefined) setReducedMotion(prefs.reducedMotion);
  if (prefs.sound !== undefined) setSound(prefs.sound);
  if (prefs.haptics !== undefined) setHaptics(prefs.haptics);
  if (prefs.voice !== undefined) setVoice(prefs.voice);
}

export function applyTheme(id: ThemeId, prefs?: A11yPrefs) {
  if (typeof document === "undefined") return;
  const p = prefs ?? getStoredPrefs();
  const effective: ThemeId = id === "club" ? "club" : p.mode === "light" ? "paper" : id;
  const root = document.documentElement;
  root.dataset.theme = effective;
  root.dataset.mode = p.mode;
  const meta = THEMES.find((t) => t.id === effective);
  if (id === "club" ? p.mode === "light" : meta?.mode === "light") root.classList.remove("dark");
  else root.classList.add("dark");
  applyPrefs(p);
}

export function setTheme(id: ThemeId) {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(STORAGE_KEY, id);
  }
  applyTheme(id);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("theme-change", { detail: id }));
  }
}

export function setMode(mode: ColorMode) {
  if (typeof window !== "undefined") window.localStorage.setItem(MODE_KEY, mode);
  applyTheme(getStoredTheme());
}

export function setHighContrast(on: boolean) {
  if (typeof window !== "undefined") window.localStorage.setItem(HC_KEY, on ? "1" : "0");
  applyTheme(getStoredTheme());
}

export function setReducedMotion(on: boolean) {
  if (typeof window !== "undefined") window.localStorage.setItem(RM_KEY, on ? "1" : "0");
  applyTheme(getStoredTheme());
}

export function setAccent(hex: string | null) {
  if (typeof window !== "undefined") {
    if (hex) window.localStorage.setItem(ACCENT_KEY, hex);
    else window.localStorage.removeItem(ACCENT_KEY);
  }
  applyTheme(getStoredTheme());
}

export function setSound(on: boolean) {
  if (typeof window !== "undefined") window.localStorage.setItem(SOUND_KEY, on ? "1" : "0");
  applyTheme(getStoredTheme());
}

export function setHaptics(on: boolean) {
  if (typeof window !== "undefined") window.localStorage.setItem(HAPTICS_KEY, on ? "1" : "0");
  applyTheme(getStoredTheme());
}

export function setVoice(on: boolean) {
  if (typeof window !== "undefined") window.localStorage.setItem(VOICE_KEY, on ? "1" : "0");
  applyTheme(getStoredTheme());
}

export const ACCENT_PRESETS = [
  "#2dd4a8",
  "#4f46e5",
  "#e85d3a",
  "#c9a84c",
  "#ec4899",
  "#38bdf8",
  "#a855f7",
  "#f43f5e",
];
