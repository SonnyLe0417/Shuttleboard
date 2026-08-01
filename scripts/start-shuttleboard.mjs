import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tracknetDir = resolve(
  process.env.TRACKNET_DIR ?? resolve(appDir, "..", "TrackNet-Badminton-Tracking-tensorflow2-main"),
);
const pythonPath = resolve(
  process.env.TRACKNET_PYTHON ?? resolve(tracknetDir, ".venv311", "Scripts", "python.exe"),
);
const tracknetPort = process.env.TRACKNET_PORT ?? "8000";
const appPort = process.env.SHUTTLEBOARD_PORT ?? "5173";
const ffmpegCandidates = [
  process.env.TRACKNET_FFMPEG,
  "C:\\Program Files\\obs-studio\\bin\\64bit\\ffmpeg.exe",
  "C:\\Program Files\\Streamlabs OBS\\resources\\app.asar.unpacked\\node_modules\\obs-studio-node\\ffmpeg.exe",
].filter(Boolean);
const ffmpegPath = ffmpegCandidates.find((candidate) => existsSync(candidate));

if (!existsSync(tracknetDir)) {
  console.error(`TrackNet folder not found: ${tracknetDir}`);
  console.error("Set TRACKNET_DIR to the folder containing tracknet_service.py to override it.");
  process.exit(1);
}

if (!existsSync(pythonPath)) {
  console.error(`TrackNet Python environment not found: ${pythonPath}`);
  console.error("Create the .venv311 environment or set TRACKNET_PYTHON to its Python executable.");
  process.exit(1);
}

const children = [];
let shuttingDown = false;

function start(label, command, args, cwd, env = {}) {
  const child = spawn(command, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: ["inherit", "pipe", "pipe"],
    windowsHide: false,
  });

  child.stdout.on("data", (data) => process.stdout.write(`[${label}] ${data}`));
  child.stderr.on("data", (data) => process.stderr.write(`[${label}] ${data}`));
  child.on("error", (error) => {
    console.error(`[${label}] ${error.message}`);
    shutdown(1);
  });
  child.on("exit", (code, signal) => {
    if (!shuttingDown && (code ?? 0) !== 0) {
      console.error(`[${label}] exited with ${signal ?? `code ${code}`}.`);
      shutdown(code ?? 1);
    }
  });

  children.push(child);
  return child;
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) child.kill();
  }
  setTimeout(() => process.exit(code), 250);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

console.log(`Starting ShuttleBoard on http://127.0.0.1:${appPort}`);
console.log(`Starting TrackNet on http://127.0.0.1:${tracknetPort}`);

start(
  "tracknet",
  pythonPath,
  ["-m", "uvicorn", "tracknet_service:app", "--host", "127.0.0.1", "--port", tracknetPort],
  tracknetDir,
  {
    PYTHONUNBUFFERED: "1",
    TRACKNET_BACKEND: process.env.TRACKNET_BACKEND ?? "openvino",
    TRACKNET_DEVICE: process.env.TRACKNET_DEVICE ?? "AUTO",
    TRACKNET_BATCH_SIZE: process.env.TRACKNET_BATCH_SIZE ?? "1",
    TRACKNET_FRAME_STRIDE: process.env.TRACKNET_FRAME_STRIDE ?? "4",
    TRACKNET_INTRA_THREADS: process.env.TRACKNET_INTRA_THREADS ?? "2",
    TRACKNET_INTER_THREADS: process.env.TRACKNET_INTER_THREADS ?? "1",
    TF_NUM_INTRAOP_THREADS: process.env.TF_NUM_INTRAOP_THREADS ?? "2",
    TF_NUM_INTEROP_THREADS: process.env.TF_NUM_INTEROP_THREADS ?? "1",
    OMP_NUM_THREADS: process.env.OMP_NUM_THREADS ?? "2",
    MKL_NUM_THREADS: process.env.MKL_NUM_THREADS ?? "2",
    ...(ffmpegPath ? { TRACKNET_FFMPEG: ffmpegPath } : {}),
  },
);
start(
  "shuttleboard",
  process.execPath,
  [
    resolve(appDir, "node_modules", "vite", "bin", "vite.js"),
    "dev",
    "--host",
    "127.0.0.1",
    "--port",
    appPort,
  ],
  appDir,
);
