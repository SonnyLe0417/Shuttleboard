import type { MatchState } from "@/hooks/useBadmintonMatch";
import { totalMatchPoints } from "@/lib/match-controller";

export function matchToCsv(state: MatchState): string {
  const lines: string[] = [];
  lines.push("event,detail,team_a,team_b,timestamp");
  const start = state.matchStartedAt ?? Date.now();
  lines.push(
    `match_start,${escape(state.preset.label)},${escape(state.names[0])},${escape(state.names[1])},${new Date(start).toISOString()}`,
  );
  state.log
    .slice()
    .reverse()
    .forEach((entry) => {
      lines.push(
        `log,${escape(entry.text)},${entry.score[0]},${entry.score[1]},${new Date(entry.at).toISOString()}`,
      );
    });
  lines.push(`games,,${state.games[0]},${state.games[1]},`);
  lines.push(`longest_rally_seconds,,${(state.longestRallyMs / 1000).toFixed(2)},,`);
  return lines.join("\n");
}

function escape(v: string) {
  const s = String(v).replace(/"/g, '""');
  return /[,"\r\n]/.test(s) ? `"${s}"` : s;
}

export function downloadText(filename: string, mime: string, contents: string) {
  downloadBlob(filename, new Blob([contents], { type: mime }));
}

export { totalMatchPoints } from "@/lib/match-controller";

export function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Renders a shareable summary card as a PNG blob. */
export async function renderShareCard(state: MatchState): Promise<Blob> {
  const w = 1200,
    h = 630;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;

  const primary = getVar("--primary") || "#2dd4a8";
  const bg = getVar("--background") || "#0d1b2a";
  const card = getVar("--card") || "#132132";
  const fg = getVar("--foreground") || "#f2fbf7";
  const muted = getVar("--muted-foreground") || "#94a3b8";

  // Background
  const grad = ctx.createLinearGradient(0, 0, w, h);
  grad.addColorStop(0, bg);
  grad.addColorStop(1, card);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  // Corner glow
  const glow = ctx.createRadialGradient(w * 0.15, 0, 0, w * 0.15, 0, 500);
  glow.addColorStop(0, hexAlpha(primary, 0.35));
  glow.addColorStop(1, "transparent");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, w, h);

  // Title
  ctx.fillStyle = primary;
  ctx.font = "600 22px system-ui, -apple-system, Segoe UI, sans-serif";
  ctx.fillText("SHUTTLEBOARD · MATCH SUMMARY", 60, 80);

  // Preset chip
  ctx.fillStyle = hexAlpha(primary, 0.15);
  const chipTxt = state.preset.label;
  ctx.font = "600 18px system-ui, sans-serif";
  const chipW = ctx.measureText(chipTxt).width + 32;
  roundRect(ctx, 60, 100, chipW, 36, 18);
  ctx.fill();
  ctx.fillStyle = primary;
  ctx.fillText(chipTxt, 76, 124);

  // Scores
  ctx.fillStyle = fg;
  ctx.font = "700 40px system-ui, sans-serif";
  ctx.fillText(state.names[0] || "Team A", 60, 220);
  ctx.fillText(state.names[1] || "Team B", 60, 320);

  ctx.font = "800 120px system-ui, sans-serif";
  ctx.textAlign = "right";
  ctx.fillStyle = primary;
  ctx.fillText(String(state.score[0]), w - 60, 240);
  ctx.fillStyle = fg;
  ctx.fillText(String(state.score[1]), w - 60, 340);
  ctx.textAlign = "left";

  // Games line
  ctx.fillStyle = muted;
  ctx.font = "500 22px system-ui, sans-serif";
  ctx.fillText(`Games won: ${state.games[0]} — ${state.games[1]}`, 60, 400);

  // Stats grid
  const totalPoints = totalMatchPoints(state);
  const rallies = state.rallyHistory.length;
  const avgSec =
    rallies > 0 ? state.rallyHistory.reduce((s, r) => s + r.ms, 0) / rallies / 1000 : 0;
  const longestSec = state.longestRallyMs / 1000;

  const stats: Array<[string, string]> = [
    ["Total points", String(totalPoints)],
    ["Rallies", String(rallies)],
    ["Avg rally", `${avgSec.toFixed(1)}s`],
    ["Longest", `${longestSec.toFixed(1)}s`],
  ];
  stats.forEach(([k, v], i) => {
    const x = 60 + i * 280;
    ctx.fillStyle = muted;
    ctx.font = "600 14px system-ui, sans-serif";
    ctx.fillText(k.toUpperCase(), x, 470);
    ctx.fillStyle = fg;
    ctx.font = "700 42px system-ui, sans-serif";
    ctx.fillText(v, x, 520);
  });

  // Footer
  ctx.fillStyle = muted;
  ctx.font = "500 16px system-ui, sans-serif";
  const date = new Date(state.matchStartedAt ?? Date.now()).toLocaleString();
  ctx.fillText(date, 60, h - 40);
  ctx.textAlign = "right";
  ctx.fillStyle = primary;
  ctx.fillText("shuttleboard.app", w - 60, h - 40);

  return await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), "image/png"));
}

export async function renderProgressShareCard(data: {
  name: string;
  handle?: string;
  matches: number;
  winRate: number;
  streak: number;
  level?: string;
  achievement?: string;
  title?: string;
}): Promise<Blob> {
  return renderTextCard(
    data.title ?? "SHUTTLEBOARD · PLAYER PROGRESS",
    data.name,
    data.handle ? `@${data.handle}` : "",
    [
      ["Matches", String(data.matches)],
      ["Win rate", `${data.winRate}%`],
      ["Streak", `${data.streak}`],
      ["Level", data.level ?? "New Player"],
    ],
    data.achievement ? `Achievement · ${data.achievement}` : "Make every rally count.",
  );
}

export async function renderHeadToHeadShareCard(data: {
  me: string;
  opponent: string;
  matches: number;
  winsMe: number;
  winsThem: number;
}): Promise<Blob> {
  return renderTextCard(
    "SHUTTLEBOARD · HEAD-TO-HEAD",
    `@${data.me}  vs  @${data.opponent}`,
    "Rivalry record",
    [
      ["Matches", String(data.matches)],
      [data.me, String(data.winsMe)],
      [data.opponent, String(data.winsThem)],
    ],
    "Keep the rivalry going.",
  );
}

async function renderTextCard(
  title: string,
  headline: string,
  subhead: string,
  stats: Array<[string, string]>,
  footer: string,
): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = 1200;
  canvas.height = 630;
  const ctx = canvas.getContext("2d")!;
  const primary = getVar("--primary") || "#2dd4a8";
  const bg = getVar("--background") || "#0d1b2a";
  const fg = getVar("--foreground") || "#f2fbf7";
  const muted = getVar("--muted-foreground") || "#94a3b8";
  const grad = ctx.createLinearGradient(0, 0, 1200, 630);
  grad.addColorStop(0, bg);
  grad.addColorStop(1, getVar("--card") || "#132132");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 1200, 630);
  ctx.fillStyle = primary;
  ctx.font = "600 22px system-ui";
  ctx.fillText(title, 60, 80);
  ctx.fillStyle = fg;
  ctx.font = "800 58px system-ui";
  ctx.fillText(headline.slice(0, 34), 60, 190);
  ctx.fillStyle = muted;
  ctx.font = "500 24px system-ui";
  ctx.fillText(subhead.slice(0, 48), 60, 235);
  stats.forEach(([label, value], i) => {
    const x = 60 + i * (1100 / Math.max(1, stats.length));
    ctx.fillStyle = muted;
    ctx.font = "600 15px system-ui";
    ctx.fillText(label.toUpperCase().slice(0, 16), x, 380);
    ctx.fillStyle = fg;
    ctx.font = "800 38px system-ui";
    ctx.fillText(value.slice(0, 18), x, 430);
  });
  ctx.fillStyle = primary;
  ctx.font = "600 20px system-ui";
  ctx.fillText(footer.slice(0, 60), 60, 540);
  ctx.fillStyle = muted;
  ctx.font = "500 16px system-ui";
  ctx.fillText("shuttleboard.app", 60, 580);
  return await new Promise<Blob>((resolve) => canvas.toBlob((blob) => resolve(blob!), "image/png"));
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function getVar(name: string): string {
  if (typeof window === "undefined") return "";
  const val = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  // If it's oklch(...), draw via a temp element to resolve to rgb
  if (val.startsWith("oklch") || val.startsWith("var(")) {
    const d = document.createElement("div");
    d.style.color = val;
    document.body.appendChild(d);
    const rgb = getComputedStyle(d).color;
    d.remove();
    return rgb;
  }
  return val;
}

function hexAlpha(color: string, alpha: number): string {
  // works for rgb() and rgba() strings
  const m = color.match(/rgba?\(([^)]+)\)/);
  if (m) {
    const parts = m[1].split(",").map((s) => s.trim());
    return `rgba(${parts[0]}, ${parts[1]}, ${parts[2]}, ${alpha})`;
  }
  return color;
}
