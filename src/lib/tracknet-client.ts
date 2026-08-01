export interface TrackNetPoint {
  frame: number;
  time: number;
  x: number | null;
  y: number | null;
  confidence: number;
  visible: boolean;
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

const TRACKNET_URL = (import.meta.env.VITE_TRACKNET_URL ?? "http://127.0.0.1:8000").replace(
  /\/$/,
  "",
);

function absoluteUrl(path: string) {
  return path.startsWith("http") ? path : `${TRACKNET_URL}${path}`;
}

export async function submitTrackNetVideo(file: File): Promise<{ jobId: string }> {
  const body = new FormData();
  body.append("video", file, file.name);
  const response = await fetch(`${TRACKNET_URL}/analyze`, { method: "POST", body });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `TrackNet upload failed (${response.status}).`);
  }
  const payload = (await response.json()) as { job_id: string };
  return { jobId: payload.job_id };
}

export async function createTrackNetPreview(file: File): Promise<string> {
  const body = new FormData();
  body.append("video", file, file.name);
  const response = await fetch(`${TRACKNET_URL}/preview`, { method: "POST", body });
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
) {
  for (;;) {
    const response = await fetch(`${TRACKNET_URL}/jobs/${jobId}`);
    if (!response.ok) throw new Error(`TrackNet status failed (${response.status}).`);
    const status = (await response.json()) as TrackNetJobStatus;
    onProgress?.(status.progress ?? 0, status.eta_seconds);
    if (status.status === "completed") return;
    if (status.status === "failed") throw new Error(status.error || "TrackNet analysis failed.");
    await new Promise((resolve) => window.setTimeout(resolve, 1000));
  }
}

export async function getTrackNetResult(jobId: string): Promise<TrackNetResult> {
  const response = await fetch(`${TRACKNET_URL}/jobs/${jobId}/result`);
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `TrackNet result failed (${response.status}).`);
  }
  const result = (await response.json()) as TrackNetResult;
  return { ...result, video_url: absoluteUrl(result.video_url) };
}
