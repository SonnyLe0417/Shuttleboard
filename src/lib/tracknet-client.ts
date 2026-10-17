import { openLiveTrackNet } from "./live-tracknet-connection";
export interface TrackNetPoint {
  frame: number;
  time: number;
  x: number | null;
  y: number | null;
  confidence: number;
  visible: boolean;
  detected?: boolean;
  repaired?: boolean;
}

export interface TrackNetSettings {
  backend: "openvino" | "pytorch";
  device: "CPU" | "GPU" | "AUTO";
  evalMode: "weight" | "average" | "nonoverlap";
  inpaint: boolean;
  intraThreads: number;
}

export interface TrackNetJobStatus {
  job_id: string;
  status: "queued" | "processing" | "completed" | "failed";
  progress: number;
  frames: number;
  total_frames?: number;
  eta_seconds?: number | null;
  error?: string;
}

export interface TrackNetResult {
  job_id: string;
  frames: number;
  coordinates: TrackNetPoint[];
  video_url: string;
}

export interface TrackNetHealth {
  ok: boolean;
  model_loaded: boolean;
  engine?: "current" | "v3" | string;
  backend?: string;
  device?: string;
  error?: string | null;
}

export interface LiveTrackNetDetection {
  type: "ready" | "detection" | "error";
  frame?: number;
  timestamp?: number;
  x?: number | null;
  y?: number | null;
  confidence?: number;
  visible?: boolean;
  processing_ms?: number;
  backend?: string;
  device?: string;
  frame_stack?: number;
  error?: string;
}

export interface LiveTrackNetConnection {
  socket: WebSocket;
  sendFrame: (
    image: string | ArrayBuffer,
    frame: number,
    timestamp: number,
    courtCorners?: unknown,
  ) => void;
  close: () => void;
}

const TRACKNET_URL = (import.meta.env.VITE_TRACKNET_URL ?? "http://127.0.0.1:8000").replace(
  /\/$/,
  "",
);

function websocketUrl(path: string) {
  const url = new URL(`${TRACKNET_URL}${path}`);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

export function connectLiveTrackNet(
  onMessage: (message: LiveTrackNetDetection) => void,
  onError?: (error: Event) => void,
  onClose?: () => void,
  options: { signal?: AbortSignal; readyTimeoutMs?: number; frameTimeoutMs?: number } = {},
): Promise<LiveTrackNetConnection> {
  return openLiveTrackNet(
    websocketUrl("/live/tracknet-fast"),
    onMessage,
    onError,
    onClose,
    options,
  );
}

export function closeLiveTrackNet(connection: LiveTrackNetConnection | null | undefined) {
  connection?.close();
}

function absoluteUrl(path: string) {
  return path.startsWith("http") ? path : `${TRACKNET_URL}${path}`;
}

export async function getTrackNetHealth(signal?: AbortSignal): Promise<TrackNetHealth> {
  const response = await fetch(`${TRACKNET_URL}/health`, {
    signal: requestSignal(signal, 10_000),
  });
  if (!response.ok) throw new Error(`TrackNet health check failed (${response.status}).`);
  return (await response.json()) as TrackNetHealth;
}

export async function submitTrackNetVideo(
  file: File,
  signal?: AbortSignal,
  settings?: TrackNetSettings,
): Promise<{ jobId: string }> {
  const body = new FormData();
  body.append("video", file, file.name);
  if (settings) body.append("settings", JSON.stringify(settings));
  const response = await fetch(`${TRACKNET_URL}/analyze`, {
    method: "POST",
    body,
    signal: requestSignal(signal, 120_000),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `TrackNet upload failed (${response.status}).`);
  }
  const payload = (await response.json()) as { job_id: string };
  return { jobId: payload.job_id };
}

export async function createTrackNetPreview(file: File, signal?: AbortSignal): Promise<string> {
  const body = new FormData();
  body.append("video", file, file.name);
  const response = await fetch(`${TRACKNET_URL}/preview`, {
    method: "POST",
    body,
    signal: requestSignal(signal, 120_000),
  });
  if (!response.ok) {
    const rawDetail = await response.text();
    let detail = rawDetail;
    try {
      const payload = JSON.parse(rawDetail) as { detail?: string };
      detail = payload.detail ?? rawDetail;
    } catch {
      // Keep the raw response when the service did not return JSON.
    }
    throw new Error(detail || `Video preview conversion failed (${response.status}).`);
  }
  return URL.createObjectURL(await response.blob());
}

export async function waitForTrackNet(
  jobId: string,
  onProgress?: (progress: number, etaSeconds: number | null | undefined) => void,
  signal?: AbortSignal,
) {
  let lastProgress = -1;
  let lastChange = Date.now();
  for (;;) {
    signal?.throwIfAborted();
    const response = await fetch(`${TRACKNET_URL}/jobs/${encodeURIComponent(jobId)}`, {
      signal: requestSignal(signal, 20_000),
    });
    if (!response.ok) throw new Error(`TrackNet status failed (${response.status}).`);
    const status = (await response.json()) as TrackNetJobStatus;
    if (status.progress !== lastProgress) {
      lastProgress = status.progress;
      lastChange = Date.now();
    }
    if (Date.now() - lastChange > 10 * 60_000)
      throw new Error(
        "TrackNet has not reported progress for ten minutes. Check the service and retry.",
      );
    onProgress?.(status.progress ?? 0, status.eta_seconds);
    if (status.status === "completed") return;
    if (status.status === "failed") throw new Error(status.error || "TrackNet analysis failed.");
    await new Promise<void>((resolve, reject) => {
      const abort = () => {
        clearTimeout(timer);
        reject(new DOMException("Cancelled", "AbortError"));
      };
      const timer = setTimeout(() => {
        signal?.removeEventListener("abort", abort);
        resolve();
      }, 1000);
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) abort();
    });
  }
}

export async function getTrackNetResult(
  jobId: string,
  signal?: AbortSignal,
): Promise<TrackNetResult> {
  const response = await fetch(`${TRACKNET_URL}/jobs/${encodeURIComponent(jobId)}/result`, {
    signal: requestSignal(signal, 30_000),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `TrackNet result failed (${response.status}).`);
  }
  const result = (await response.json()) as TrackNetResult;
  return { ...result, video_url: absoluteUrl(result.video_url) };
}

export async function cancelTrackNetJob(jobId: string): Promise<void> {
  // Older services have no cancellation route. Clearing their UI still works.
  try {
    await fetch(`${TRACKNET_URL}/jobs/${encodeURIComponent(jobId)}`, {
      method: "DELETE",
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    // A stopped service must not prevent selecting a new video.
  }
}

function requestSignal(signal: AbortSignal | undefined, timeoutMs: number) {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}
