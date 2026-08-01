import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Upload,
  Play,
  Pause,
  RotateCcw,
  Trophy,
  AlertCircle,
  Sparkles,
  CheckCircle2,
  Clock3,
  Target,
  ListVideo,
} from "lucide-react";
import {
  detectBirdieMotion,
  LOCAL_TRACK_WIDTH,
  LOCAL_TRACK_MIN_CONFIDENCE,
  computeHomography,
  applyHomography,
  type LocalTrack,
  type Point,
} from "@/lib/birdie-tracker";
import { createTrackNetPreview, type TrackNetPoint } from "@/lib/tracknet-client";
import { useTrackNetAnalysis } from "@/components/TrackNetAnalysisProvider";

export const Route = createFileRoute("/_authenticated/video")({
  head: () => ({
    meta: [
      { title: "Video Analyzer — Badminton Game Tracker" },
      {
        name: "description",
        content: "Upload a match video, mark the court, and auto-track the shuttle and score.",
      },
      { property: "og:title", content: "Video Analyzer — Badminton Game Tracker" },
      {
        property: "og:description",
        content: "Upload a match video, mark the court, and auto-track the shuttle and score.",
      },
    ],
  }),
  component: VideoAnalyzerPage,
});

type Phase = "upload" | "calibrate" | "analyze" | "done";
type ShotType = "unknown" | "smash" | "clear" | "drop" | "drive" | "lift" | "net";

interface Rally {
  id: number;
  t: number; // video time in seconds
  landingImgX: number;
  landingImgY: number;
  landingCourtX: number;
  landingCourtY: number;
  inBounds: boolean;
  winner: "p1" | "p2";
  aiConfidence: number;
  aiNote: string;
  shotType?: ShotType;
  manuallyCorrected?: boolean;
}

interface TrailPt {
  x: number;
  y: number;
  t: number;
}

const CORNER_LABELS = [
  "Near-left corner (bottom-left of court)",
  "Near-right corner (bottom-right of court)",
  "Far-right corner (top-right of court)",
  "Far-left corner (top-left of court)",
];

const TRACKNET_COURT_STORAGE_KEY = "shuttleboard.tracknet-court";

function formatEta(seconds: number | null | undefined) {
  if (!seconds || !Number.isFinite(seconds) || seconds <= 0) return null;
  const rounded = Math.ceil(seconds);
  if (rounded < 60) return `${rounded}s`;
  const minutes = Math.floor(rounded / 60);
  const remainingSeconds = rounded % 60;
  return remainingSeconds ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
}

type VisibleTrackNetPoint = TrackNetPoint & { x: number; y: number };

function buildTrackNetRallies(points: TrackNetPoint[], homography: number[]): Rally[] {
  const visiblePoints = points.filter(
    (point): point is VisibleTrackNetPoint => point.visible && point.x !== null && point.y !== null,
  );
  if (visiblePoints.length < 6) return [];

  const chunks: VisibleTrackNetPoint[][] = [];
  let chunk: VisibleTrackNetPoint[] = [];
  let previous: VisibleTrackNetPoint | null = null;
  for (const point of visiblePoints) {
    if (previous && point.time - previous.time > 0.55) {
      if (chunk.length) chunks.push(chunk);
      chunk = [];
    }
    chunk.push(point);
    previous = point;
  }
  if (chunk.length) chunks.push(chunk);

  const endsOffCamera = (candidate: VisibleTrackNetPoint[]) => {
    const last = candidate[candidate.length - 1];
    const nearTop = last.y < 0.14;
    const nearSide = last.x < 0.04 || last.x > 0.96;
    const tail = candidate.slice(-Math.min(8, candidate.length));
    const firstTail = tail[0];
    const elapsed = last.time - firstTail.time;
    const rising = elapsed > 0 && (last.y - firstTail.y) / elapsed < -0.08;
    return nearTop || nearSide || (last.y < 0.4 && rising);
  };

  // A clear can leave the camera for a short period and then reappear. Do not
  // turn that temporary gap into a point; merge it back into the same rally.
  const mergedChunks: VisibleTrackNetPoint[][] = [];
  for (const nextChunk of chunks) {
    const current = mergedChunks[mergedChunks.length - 1];
    const currentLast = current?.[current.length - 1];
    const nextFirst = nextChunk[0];
    if (
      current &&
      currentLast &&
      nextFirst.time - currentLast.time <= 1.8 &&
      endsOffCamera(current)
    ) {
      current.push(...nextChunk);
    } else {
      mergedChunks.push([...nextChunk]);
    }
  }

  const rallies: Rally[] = [];
  const finishSegment = (segment: VisibleTrackNetPoint[]) => {
    if (segment.length < 6) {
      return;
    }
    const first = segment[0];
    const last = segment[segment.length - 1];
    if (last.time - first.time < 0.4) {
      return;
    }
    if (endsOffCamera(segment)) {
      return;
    }

    const court = applyHomography(homography, { x: last.x, y: last.y });
    const inBounds = court.x >= -0.02 && court.x <= 1.02 && court.y >= -0.02 && court.y <= 1.02;
    // A shuttle landing on the near half gives the point to the far player;
    // landing on the far half gives it to the near player.
    const winner: "p1" | "p2" = court.y > 0.5 ? "p2" : "p1";
    const confidence = segment.reduce((sum, point) => sum + point.confidence, 0) / segment.length;

    rallies.push({
      id: rallies.length + 1,
      t: last.time,
      landingImgX: last.x,
      landingImgY: last.y,
      landingCourtX: court.x,
      landingCourtY: court.y,
      inBounds,
      winner,
      aiConfidence: confidence,
      aiNote: "TrackNet auto-scored from visible landing evidence and court side.",
    });
  };

  for (const candidate of mergedChunks) finishSegment(candidate);
  return rallies;
}

function VideoAnalyzerPage() {
  const [phase, setPhase] = useState<Phase>("upload");
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [tracknetVideoUrl, setTracknetVideoUrl] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [analysisMode, setAnalysisMode] = useState<"browser" | "tracknet">("browser");
  const [tracknetPoints, setTracknetPoints] = useState<TrackNetPoint[]>([]);
  const [corners, setCorners] = useState<Point[]>([]); // in displayed pixel space of the calibrate canvas
  const [displaySize, setDisplaySize] = useState({ w: 0, h: 0 });
  const [playing, setPlaying] = useState(false);
  const [score, setScore] = useState({ p1: 0, p2: 0 });
  const [rallies, setRallies] = useState<Rally[]>([]);
  const [status, setStatus] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [lastHitter, setLastHitter] = useState<"p1" | "p2">("p1");
  const [selectedRally, setSelectedRally] = useState<number | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const calibCanvasRef = useRef<HTMLCanvasElement>(null);
  const workRef = useRef<HTMLCanvasElement>(null); // hidden small canvas for detection
  const homographyRef = useRef<number[] | null>(null);
  const normalizedCornersRef = useRef<Point[]>([]);
  const localTrackRef = useRef<LocalTrack | null>(null);
  const prevGrayRef = useRef<Uint8ClampedArray | null>(null);
  const trailRef = useRef<TrailPt[]>([]);
  const rallyActiveRef = useRef(false);
  const rallyStartTRef = useRef(0);
  const lastVisibleRef = useRef<{ x: number; y: number; t: number } | null>(null);
  const lastSeenTsRef = useRef(0);
  const aiPendingRef = useRef(false);
  const tracknetPointsRef = useRef<TrackNetPoint[]>([]);
  const previewAttemptedRef = useRef(false);
  const rafRef = useRef<number>(0);
  const scoreRef = useRef({ p1: 0, p2: 0 });
  const {
    start: startTrackNet,
    job: tracknetJob,
    phase: tracknetPhase,
    progress: tracknetProgress,
    etaSeconds: tracknetEtaSeconds,
    result: tracknetResult,
    error: tracknetError,
  } = useTrackNetAnalysis();

  useEffect(() => {
    return () => {
      if (videoUrl?.startsWith("blob:")) URL.revokeObjectURL(videoUrl);
    };
  }, [videoUrl]);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(TRACKNET_COURT_STORAGE_KEY);
      if (!stored) return;
      const parsed = JSON.parse(stored) as {
        corners?: Point[];
        homography?: number[];
      };
      if (
        Array.isArray(parsed.corners) &&
        parsed.corners.length === 4 &&
        Array.isArray(parsed.homography) &&
        parsed.homography.length === 9
      ) {
        normalizedCornersRef.current = parsed.corners;
        homographyRef.current = parsed.homography;
      }
    } catch {
      // A missing or malformed saved calibration should not block analysis.
    }
  }, []);

  useEffect(() => {
    if (!tracknetJob) return;
    setAnalysisMode("tracknet");

    if (
      tracknetPhase === "uploading" ||
      tracknetPhase === "queued" ||
      tracknetPhase === "processing"
    ) {
      setPhase("analyze");
      const eta = formatEta(tracknetEtaSeconds);
      setStatus(
        `TrackNet analyzing video… ${Math.round(tracknetProgress * 100)}%${eta ? ` · about ${eta} remaining` : " · estimating time"}`,
      );
      return;
    }

    if (tracknetPhase === "completed" && tracknetResult) {
      setTracknetPoints(tracknetResult.coordinates);
      tracknetPointsRef.current = tracknetResult.coordinates;
      const scoredRallies = homographyRef.current
        ? buildTrackNetRallies(tracknetResult.coordinates, homographyRef.current)
        : [];
      const scored = scoredRallies.reduce(
        (currentScore, rally) => ({
          p1: currentScore.p1 + (rally.winner === "p1" ? 1 : 0),
          p2: currentScore.p2 + (rally.winner === "p2" ? 1 : 0),
        }),
        { p1: 0, p2: 0 },
      );
      scoreRef.current = scored;
      setScore(scored);
      setRallies(scoredRallies);
      setTracknetVideoUrl(tracknetResult.video_url);
      setVideoUrl(tracknetResult.video_url);
      setPhase("done");
      setStatus(
        `TrackNet complete: ${tracknetResult.frames} frames analyzed and ${scoredRallies.length} rallies scored.`,
      );
      return;
    }

    if (tracknetPhase === "failed") {
      setPhase(selectedFile ? "calibrate" : "upload");
      setStatus("");
      setError(
        `TrackNet is unavailable. ${tracknetError ?? "The analysis could not be completed."}`,
      );
    }
  }, [
    selectedFile,
    tracknetEtaSeconds,
    tracknetError,
    tracknetJob,
    tracknetPhase,
    tracknetProgress,
    tracknetResult,
  ]);

  // -------- Upload --------
  const correctRally = (
    id: number,
    patch: Partial<Pick<Rally, "winner" | "inBounds" | "shotType">>,
  ) => {
    setRallies((current) => {
      const previous = current.find((r) => r.id === id);
      if (!previous) return current;
      if (patch.winner && patch.winner !== previous.winner) {
        scoreRef.current = {
          p1: scoreRef.current.p1 + (patch.winner === "p1" ? 1 : -1),
          p2: scoreRef.current.p2 + (patch.winner === "p2" ? 1 : -1),
        };
        setScore({ ...scoreRef.current });
      }
      return current.map((r) => (r.id === id ? { ...r, ...patch, manuallyCorrected: true } : r));
    });
  };
  const onFile = (file: File) => {
    setError(null);
    if (!file.type.startsWith("video/")) {
      setError("Please upload a video file.");
      return;
    }
    const url = URL.createObjectURL(file);
    setSelectedFile(file);
    previewAttemptedRef.current = false;
    setVideoUrl(url);
    setTracknetVideoUrl(null);
    setTracknetPoints([]);
    tracknetPointsRef.current = [];
    setCorners([]);
    setPhase("calibrate");
    resetAnalysisState();
  };

  const handleVideoError = () => {
    if (!selectedFile || previewAttemptedRef.current) {
      setError("This video could not be loaded. Try exporting it as an MP4 or MOV file.");
      return;
    }

    previewAttemptedRef.current = true;
    setError("Preparing a browser-compatible preview of this video…");
    void createTrackNetPreview(selectedFile)
      .then((previewUrl) => {
        setVideoUrl(previewUrl);
        setError(null);
      })
      .catch((previewError) => {
        setError(
          `This video could not be previewed. ${previewError instanceof Error ? previewError.message : "Try exporting it as an MP4 or MOV file."}`,
        );
      });
  };

  const resetAnalysisState = () => {
    localTrackRef.current = null;
    prevGrayRef.current = null;
    trailRef.current = [];
    rallyActiveRef.current = false;
    lastVisibleRef.current = null;
    lastSeenTsRef.current = 0;
    scoreRef.current = { p1: 0, p2: 0 };
    setScore({ p1: 0, p2: 0 });
    setRallies([]);
    setStatus("");
    setSelectedRally(null);
  };

  const runTrackNetAnalysis = async () => {
    if (!selectedFile) return;
    setError(null);
    setStatus("Uploading video to TrackNet…");
    setPhase("analyze");
    await startTrackNet(selectedFile);
  };

  // -------- Calibrate: draw first frame + capture clicks --------
  useEffect(() => {
    if (phase !== "calibrate") return;
    const video = videoRef.current;
    const canvas = calibCanvasRef.current;
    if (!video || !canvas) return;

    const draw = () => {
      if (!video.videoWidth || !video.videoHeight) return;
      const maxW = Math.min(720, window.innerWidth - 40);
      const scale = maxW / video.videoWidth;
      const w = Math.round(video.videoWidth * scale);
      const h = Math.round(video.videoHeight * scale);
      canvas.width = w;
      canvas.height = h;
      setDisplaySize({ w, h });
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, w, h);
      drawCornersOverlay(ctx, corners, w, h);
    };

    const onLoaded = () => {
      if (video.currentTime === 0) {
        video.currentTime = Math.min(0.1, video.duration / 2);
      }
      draw();
    };
    const onSeeked = () => draw();

    video.addEventListener("loadeddata", onLoaded);
    video.addEventListener("seeked", onSeeked);
    if (video.readyState >= 2) onLoaded();
    return () => {
      video.removeEventListener("loadeddata", onLoaded);
      video.removeEventListener("seeked", onSeeked);
    };
  }, [phase, corners]);

  const onCalibClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (corners.length >= 4) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * e.currentTarget.width;
    const y = ((e.clientY - rect.top) / rect.height) * e.currentTarget.height;
    setCorners([...corners, { x, y }]);
  };

  const startAnalysis = () => {
    if (corners.length !== 4) return;
    const video = videoRef.current;
    if (!video) return;
    // Normalize corner coordinates to 0..1 image space so homography works
    // for the small detection canvas too.
    const normCorners = corners.map((c) => ({
      x: c.x / displaySize.w,
      y: c.y / displaySize.h,
    }));
    normalizedCornersRef.current = normCorners;
    // Map to a normalized court where near baseline is at cy=1, far at cy=0.
    const dst: Point[] = [
      { x: 0, y: 1 }, // near-left
      { x: 1, y: 1 }, // near-right
      { x: 1, y: 0 }, // far-right
      { x: 0, y: 0 }, // far-left
    ];
    homographyRef.current = computeHomography(normCorners, dst);
    if (analysisMode === "tracknet" && homographyRef.current) {
      try {
        window.localStorage.setItem(
          TRACKNET_COURT_STORAGE_KEY,
          JSON.stringify({ corners: normCorners, homography: homographyRef.current }),
        );
      } catch {
        // Scoring still works during the current page session if storage is unavailable.
      }
    }
    resetAnalysisState();
    if (analysisMode === "tracknet") {
      void runTrackNetAnalysis();
      return;
    }
    setPhase("analyze");
    video.currentTime = 0;
    setTimeout(() => {
      video.play();
      setPlaying(true);
    }, 100);
  };

  // -------- Analyze loop --------
  useEffect(() => {
    if (phase !== "analyze" || analysisMode !== "browser") return;
    const video = videoRef.current;
    const overlay = overlayRef.current;
    const work = workRef.current;
    if (!video || !overlay || !work) return;

    const sync = () => {
      const maxW = Math.min(720, window.innerWidth - 40);
      const scale = maxW / video.videoWidth;
      overlay.width = Math.round(video.videoWidth * scale);
      overlay.height = Math.round(video.videoHeight * scale);
      work.width = LOCAL_TRACK_WIDTH;
      work.height = Math.round((LOCAL_TRACK_WIDTH * video.videoHeight) / video.videoWidth);
    };
    sync();

    let cancelled = false;
    const step = () => {
      if (cancelled) return;
      processFrame();
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);

    const onEnded = () => {
      setPlaying(false);
      setPhase("done");
      setStatus("Analysis complete.");
    };
    video.addEventListener("ended", onEnded);
    return () => {
      cancelled = true;
      cancelAnimationFrame(rafRef.current);
      video.removeEventListener("ended", onEnded);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysisMode, phase]);

  const processFrame = useCallback(() => {
    const video = videoRef.current;
    const overlay = overlayRef.current;
    const work = workRef.current;
    if (!video || !overlay || !work || video.paused || video.ended) return;

    const wctx = work.getContext("2d", { willReadFrequently: true });
    if (!wctx) return;
    wctx.drawImage(video, 0, 0, work.width, work.height);
    const rgba = wctx.getImageData(0, 0, work.width, work.height).data as Uint8ClampedArray;

    const now = performance.now();
    const detection = detectBirdieMotion(
      rgba,
      prevGrayRef.current,
      localTrackRef.current,
      work.width,
      work.height,
      now,
    );
    prevGrayRef.current = detection.gray;
    localTrackRef.current = detection.track;

    const t = video.currentTime;
    const track = detection.track;
    const visibleNow = Boolean(
      track && track.visible && track.confidence > LOCAL_TRACK_MIN_CONFIDENCE,
    );

    if (visibleNow && track) {
      lastVisibleRef.current = { x: track.x, y: track.y, t };
      lastSeenTsRef.current = now;
      const last = trailRef.current[trailRef.current.length - 1];
      const jump = last ? Math.hypot(track.x - last.x, track.y - last.y) : 0;
      if (!last || jump < 0.18) {
        const sx = last ? last.x * 0.45 + track.x * 0.55 : track.x;
        const sy = last ? last.y * 0.45 + track.y * 0.55 : track.y;
        trailRef.current.push({ x: sx, y: sy, t: now });
      } else {
        trailRef.current = [{ x: track.x, y: track.y, t: now }];
      }
      trailRef.current = trailRef.current.filter((p) => now - p.t < 1100);

      if (!aiPendingRef.current && !rallyActiveRef.current && (track.hits ?? 0) >= 4) {
        rallyActiveRef.current = true;
        rallyStartTRef.current = t;
      }
    } else if (rallyActiveRef.current && lastVisibleRef.current) {
      // Track lost. If gone for > 500ms and rally lasted > 400ms, treat as landing.
      const goneMs = now - lastSeenTsRef.current;
      const rallyDurMs = (t - rallyStartTRef.current) * 1000;
      if (goneMs > 500 && rallyDurMs > 400 && !aiPendingRef.current) {
        endRally();
      }
    }

    drawOverlay();
  }, []);

  const endRally = async () => {
    const video = videoRef.current;
    const last = lastVisibleRef.current;
    const H = homographyRef.current;
    if (!video || !last || !H) return;
    rallyActiveRef.current = false;
    aiPendingRef.current = true;
    const wasPlaying = !video.paused;
    if (wasPlaying) {
      video.pause();
      setPlaying(false);
    }

    // Local decision from homography
    const court = applyHomography(H, { x: last.x, y: last.y });
    const inBounds = court.x >= -0.02 && court.x <= 1.02 && court.y >= -0.02 && court.y <= 1.02;
    // Winner = opposite side of landing. cy > 0.5 → near half (P1) → P2 wins.
    let winner: "p1" | "p2" = inBounds ? lastHitter : lastHitter === "p1" ? "p2" : "p1";
    let aiConf = 0;
    let aiNote = "Auto-decided from tracker.";

    // AI double-check: send a capture of the current frame + last position.
    try {
      const cap = document.createElement("canvas");
      cap.width = 640;
      cap.height = Math.round((640 * video.videoHeight) / video.videoWidth);
      const cctx = cap.getContext("2d");
      if (cctx) {
        cctx.drawImage(video, 0, 0, cap.width, cap.height);
        const dataUrl = cap.toDataURL("image/jpeg", 0.7);
        const resp = await fetch("/api/ai-vision", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            image: dataUrl,
            mode: "singles",
            p1Side: "left",
            courtCorners: normalizedCornersRef.current,
            lastHitter,
          }),
        });
        if (resp.ok) {
          const j = await resp.json();
          if (j && (j.pointTo === "p1" || j.pointTo === "p2") && j.confidence >= 0.75) {
            winner = j.pointTo;
            aiConf = j.confidence;
            aiNote = j.reasoning ?? "AI confirmed";
          }
        }
      }
    } catch {
      // ignore AI failure — fall back to local decision
    }

    scoreRef.current = {
      p1: scoreRef.current.p1 + (winner === "p1" ? 1 : 0),
      p2: scoreRef.current.p2 + (winner === "p2" ? 1 : 0),
    };
    setScore({ ...scoreRef.current });
    setRallies((r) => [
      ...r,
      {
        id: r.length + 1,
        t: video.currentTime,
        landingImgX: last.x,
        landingImgY: last.y,
        landingCourtX: court.x,
        landingCourtY: court.y,
        inBounds,
        winner,
        aiConfidence: aiConf,
        aiNote,
      },
    ]);

    // Reset per-rally state
    localTrackRef.current = null;
    prevGrayRef.current = null;
    trailRef.current = [];
    lastVisibleRef.current = null;
    aiPendingRef.current = false;
    if (wasPlaying && videoRef.current === video) {
      void video
        .play()
        .then(() => setPlaying(true))
        .catch(() => setPlaying(false));
    }
  };

  const drawOverlay = () => {
    const overlay = overlayRef.current;
    if (!overlay) return;
    const ctx = overlay.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, overlay.width, overlay.height);

    // Court quad
    if (corners.length === 4 && displaySize.w > 0) {
      ctx.strokeStyle = "rgba(250, 204, 21, 0.55)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      corners.forEach((c, i) => {
        const x = (c.x / displaySize.w) * overlay.width;
        const y = (c.y / displaySize.h) * overlay.height;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.closePath();
      ctx.stroke();
    }

    // Trail
    const trail = trailRef.current;
    const now = performance.now();
    if (trail.length > 1) {
      ctx.lineWidth = 3;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      const W = overlay.width;
      const Hh = overlay.height;
      for (let i = 0; i < trail.length - 1; i++) {
        const p0 = trail[i === 0 ? 0 : i - 1];
        const p1 = trail[i];
        const p2 = trail[i + 1];
        const age = (now - p2.t) / 1500;
        const alpha = Math.max(0, 1 - age);
        if (alpha <= 0.02) continue;
        const startX = i === 0 ? p1.x * W : ((p0.x + p1.x) / 2) * W;
        const startY = i === 0 ? p1.y * Hh : ((p0.y + p1.y) / 2) * Hh;
        const endX = i + 2 >= trail.length ? p2.x * W : ((p1.x + p2.x) / 2) * W;
        const endY = i + 2 >= trail.length ? p2.y * Hh : ((p1.y + p2.y) / 2) * Hh;
        ctx.strokeStyle = `rgba(56, 189, 248, ${alpha.toFixed(2)})`;
        ctx.beginPath();
        ctx.moveTo(startX, startY);
        ctx.quadraticCurveTo(p1.x * W, p1.y * Hh, endX, endY);
        ctx.stroke();
      }
    }

    // Current position
    const track = localTrackRef.current;
    if (track && track.visible && track.confidence > LOCAL_TRACK_MIN_CONFIDENCE) {
      const cx = track.x * overlay.width;
      const cy = track.y * overlay.height;
      ctx.strokeStyle = "#38bdf8";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, 14, 0, Math.PI * 2);
      ctx.stroke();
    }

    // TrackNet coordinates are normalized to the source video dimensions.
    if (analysisMode === "tracknet" && tracknetPointsRef.current.length > 0) {
      const currentTime = videoRef.current?.currentTime ?? 0;
      const visiblePoints = tracknetPointsRef.current.filter(
        (point) =>
          point.visible && point.x !== null && point.y !== null && point.time <= currentTime,
      );
      const recentPoints = visiblePoints.slice(-40);
      if (recentPoints.length > 1) {
        ctx.strokeStyle = "rgba(248, 113, 113, 0.7)";
        ctx.lineWidth = 3;
        ctx.beginPath();
        recentPoints.forEach((point, index) => {
          const x = (point.x ?? 0) * overlay.width;
          const y = (point.y ?? 0) * overlay.height;
          if (index === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.stroke();
      }
      const currentPoint = visiblePoints[visiblePoints.length - 1];
      if (currentPoint && currentPoint.x !== null && currentPoint.y !== null) {
        ctx.strokeStyle = "#ef4444";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(currentPoint.x * overlay.width, currentPoint.y * overlay.height, 8, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  };

  const syncTrackNetOverlay = () => {
    const video = videoRef.current;
    const overlay = overlayRef.current;
    if (!video || !overlay || !video.videoWidth) return;
    const maxW = Math.min(720, window.innerWidth - 40);
    const scale = maxW / video.videoWidth;
    overlay.width = Math.round(video.videoWidth * scale);
    overlay.height = Math.round(video.videoHeight * scale);
    setDisplaySize({ w: overlay.width, h: overlay.height });
    drawOverlay();
  };

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      v.play();
      setPlaying(true);
    } else {
      v.pause();
      setPlaying(false);
    }
  };

  const restart = () => {
    setPhase("upload");
    setVideoUrl(null);
    setCorners([]);
    resetAnalysisState();
  };

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-4">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Badminton Game Tracker
        </p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">Video Analyzer</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Upload a match clip, tap the four court corners, and the tracker follows the shuttle to
          score rallies automatically.
        </p>
        <div className="mt-5 grid gap-2 sm:grid-cols-3">
          <WorkflowStep
            active={phase === "upload" || phase === "calibrate"}
            done={phase === "analyze" || phase === "done"}
            number="01"
            label="Set the court"
          />
          <WorkflowStep
            active={phase === "analyze"}
            done={phase === "done"}
            number="02"
            label="Track the match"
          />
          <WorkflowStep
            active={phase === "done"}
            done={false}
            number="03"
            label="Review your plan"
          />
        </div>
      </div>

      {error && (
        <div className="mb-3 flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertCircle className="h-4 w-4" /> {error}
        </div>
      )}

      {phase === "upload" && (
        <label className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-border bg-card p-10 text-center transition-colors hover:border-primary/60">
          <Upload className="mb-3 h-10 w-10 text-muted-foreground" />
          <span className="text-sm font-medium text-foreground">Click to upload a game video</span>
          <span className="mt-1 text-xs text-muted-foreground">
            MP4 / WebM / MOV — up to a few minutes
          </span>
          <input
            type="file"
            accept="video/*"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
          />
        </label>
      )}

      {phase !== "upload" && videoUrl && (
        <>
          <div className="relative aspect-video overflow-hidden rounded-xl border border-border bg-black">
            <video
              ref={videoRef}
              src={tracknetVideoUrl ?? videoUrl}
              className="block h-full w-full object-contain"
              preload="auto"
              autoPlay={phase === "calibrate"}
              playsInline
              muted
              onError={handleVideoError}
              onLoadedMetadata={syncTrackNetOverlay}
              onTimeUpdate={() => {
                if (analysisMode === "tracknet") drawOverlay();
              }}
            />
            {phase === "calibrate" && (
              <canvas
                ref={calibCanvasRef}
                onClick={onCalibClick}
                className="absolute inset-0 block h-full w-full cursor-crosshair"
              />
            )}
            {phase !== "calibrate" && (
              <canvas
                ref={overlayRef}
                className="pointer-events-none absolute inset-0 h-full w-full"
              />
            )}
          </div>
          <canvas ref={workRef} className="hidden" />
        </>
      )}

      {phase === "calibrate" && (
        <div className="mt-4 rounded-lg border border-border bg-card p-4">
          <p className="text-sm font-semibold text-foreground">
            {corners.length < 4 ? `Tap corner ${corners.length + 1} of 4` : "Four corners placed"}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {corners.length < 4 ? CORNER_LABELS[corners.length] : "All corners marked."}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
            <span className="font-medium text-foreground">Detector</span>
            <button
              type="button"
              onClick={() => setAnalysisMode("browser")}
              className={`rounded-md px-3 py-1.5 font-semibold ${analysisMode === "browser" ? "bg-primary text-primary-foreground" : "border border-input bg-background"}`}
            >
              Browser fallback
            </button>
            <button
              type="button"
              onClick={() => setAnalysisMode("tracknet")}
              className={`rounded-md px-3 py-1.5 font-semibold ${analysisMode === "tracknet" ? "bg-primary text-primary-foreground" : "border border-input bg-background"}`}
            >
              TrackNet AI
            </button>
          </div>
          <div className="mt-3 flex gap-2">
            <button
              onClick={() => setCorners([])}
              className="rounded-md border border-input bg-background px-3 py-2 text-xs font-medium hover:bg-accent"
            >
              <RotateCcw className="mr-1 inline h-3 w-3" /> Reset corners
            </button>
            <button
              onClick={startAnalysis}
              disabled={corners.length !== 4}
              className="rounded-md bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-40"
            >
              <Play className="mr-1 inline h-3 w-3" />
              {analysisMode === "tracknet" ? "Analyze with TrackNet" : "Start analysis"}
            </button>
          </div>
        </div>
      )}

      {(phase === "analyze" || phase === "done") && (
        <>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <ScoreCard label="Player 1 (near)" value={score.p1} />
            <ScoreCard label="Player 2 (far)" value={score.p2} />
          </div>

          {analysisMode === "browser" && (
            <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-3 py-2">
              <span className="text-xs text-muted-foreground">Last hitter before landing</span>
              <button
                type="button"
                onClick={() => setLastHitter("p1")}
                className={`rounded-md px-3 py-1.5 text-xs font-semibold ${lastHitter === "p1" ? "bg-primary text-primary-foreground" : "border border-input bg-background"}`}
              >
                Player 1
              </button>
              <button
                type="button"
                onClick={() => setLastHitter("p2")}
                className={`rounded-md px-3 py-1.5 text-xs font-semibold ${lastHitter === "p2" ? "bg-primary text-primary-foreground" : "border border-input bg-background"}`}
              >
                Player 2
              </button>
            </div>
          )}

          <div className="mt-3 flex flex-wrap gap-2">
            {phase === "analyze" && (
              <button
                onClick={togglePlay}
                className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground"
              >
                {playing ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
                {playing ? "Pause" : "Resume"}
              </button>
            )}
            <button
              onClick={restart}
              className="inline-flex items-center gap-2 rounded-md border border-input bg-background px-3 py-2 text-xs font-medium hover:bg-accent"
            >
              <RotateCcw className="h-3 w-3" /> New video
            </button>
          </div>

          {status && <p className="mt-2 text-xs text-muted-foreground">{status}</p>}

          {phase === "done" && tracknetVideoUrl && (
            <a
              href={tracknetVideoUrl}
              download="tracknet_predict.mp4"
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-flex text-xs font-medium text-primary underline-offset-4 hover:underline"
            >
              Download TrackNet processed video (
              {tracknetPoints.filter((point) => point.visible).length} detected frames)
            </a>
          )}

          {phase === "done" && (
            <AnalysisSummary
              rallies={rallies}
              score={score}
              tracknetPoints={analysisMode === "tracknet" ? tracknetPoints : undefined}
            />
          )}

          <div className="mt-6 rounded-2xl border border-border bg-card">
            <div className="flex items-center gap-2 border-b border-border px-4 py-3">
              <ListVideo className="h-4 w-4 text-primary" />
              <div>
                <h2 className="text-sm font-semibold">Key moments</h2>
                <p className="text-[11px] text-muted-foreground">
                  Select a rally to jump to that moment in the video.
                </p>
              </div>
            </div>
            {rallies.length === 0 ? (
              <p className="px-4 py-6 text-center text-xs text-muted-foreground">
                No rallies scored yet. They will appear here as the shuttle lands.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {rallies.map((r) => (
                  <li
                    key={r.id}
                    className={`flex cursor-pointer items-center justify-between gap-3 px-4 py-3 text-sm transition-colors ${selectedRally === r.id ? "bg-primary/10" : "hover:bg-accent/40"}`}
                    onClick={() => {
                      setSelectedRally(r.id);
                      if (videoRef.current) videoRef.current.currentTime = r.t;
                    }}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setSelectedRally(r.id);
                        if (videoRef.current) videoRef.current.currentTime = r.t;
                      }
                    }}
                  >
                    <div>
                      <p className="font-medium">
                        Rally #{r.id} — Point to {r.winner === "p1" ? "Player 1" : "Player 2"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatTime(r.t)} · Landing {r.inBounds ? "in" : "out"} ·{" "}
                        {r.aiConfidence > 0 ? `AI ${Math.round(r.aiConfidence * 100)}% — ` : ""}
                        {r.aiNote}
                      </p>
                    </div>
                    <div
                      className="mt-2 flex flex-wrap items-center gap-1.5"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <span className="text-[10px] text-muted-foreground">Correct:</span>
                      {["p1", "p2"].map((player) => (
                        <button
                          key={player}
                          type="button"
                          onClick={() => correctRally(r.id, { winner: player as "p1" | "p2" })}
                          className={`rounded border px-1.5 py-0.5 text-[10px] ${r.winner === player ? "border-primary/40 bg-primary/10 text-primary" : "border-white/10 text-muted-foreground"}`}
                        >
                          {player.toUpperCase()}
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={() => correctRally(r.id, { inBounds: !r.inBounds })}
                        className="rounded border border-white/10 px-1.5 py-0.5 text-[10px] text-muted-foreground"
                      >
                        {r.inBounds ? "Mark OUT" : "Mark IN"}
                      </button>
                      <select
                        value={r.shotType ?? "unknown"}
                        onChange={(e) =>
                          correctRally(r.id, { shotType: e.target.value as ShotType })
                        }
                        className="rounded border border-white/10 bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground"
                      >
                        <option value="unknown">Shot label</option>
                        <option value="smash">Smash</option>
                        <option value="clear">Clear</option>
                        <option value="drop">Drop</option>
                        <option value="drive">Drive</option>
                        <option value="lift">Lift</option>
                        <option value="net">Net</option>
                      </select>
                      {r.manuallyCorrected && (
                        <span className="text-[10px] font-semibold text-primary">Edited</span>
                      )}
                    </div>
                    <span
                      className={`rounded-full px-2 py-1 text-[10px] font-semibold ${r.winner === "p1" ? "bg-primary/15 text-primary" : "bg-accent text-accent-foreground"}`}
                    >
                      {r.winner.toUpperCase()}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function WorkflowStep({
  active,
  done,
  number,
  label,
}: {
  active: boolean;
  done: boolean;
  number: string;
  label: string;
}) {
  return (
    <div
      className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 ${active ? "border-primary/40 bg-primary/10" : "border-border bg-card/60"}`}
    >
      <span
        className={`flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-bold ${done ? "bg-primary text-primary-foreground" : active ? "border border-primary/50 text-primary" : "bg-muted text-muted-foreground"}`}
      >
        {done ? <CheckCircle2 className="h-4 w-4" /> : number}
      </span>
      <span
        className={`text-xs font-semibold ${active || done ? "text-foreground" : "text-muted-foreground"}`}
      >
        {label}
      </span>
    </div>
  );
}

function AnalysisSummary({
  rallies,
  score,
  tracknetPoints,
}: {
  rallies: Rally[];
  score: { p1: number; p2: number };
  tracknetPoints?: TrackNetPoint[];
}) {
  const isTrackNet = tracknetPoints !== undefined;
  const tracknetDetections = tracknetPoints?.filter((point) => point.visible) ?? [];
  const hasTrackNetScore = isTrackNet && rallies.length > 0;
  const detected = rallies.filter((r) => r.aiConfidence > 0).length;
  const confidence = isTrackNet
    ? tracknetDetections.length
      ? Math.round(
          (tracknetDetections.reduce((sum, point) => sum + point.confidence, 0) /
            tracknetDetections.length) *
            100,
        )
      : 0
    : rallies.length
      ? Math.round(
          (rallies.reduce((sum, r) => sum + (r.aiConfidence || 0.7), 0) / rallies.length) * 100,
        )
      : 0;
  const winner =
    score.p1 === score.p2 ? "Even match" : score.p1 > score.p2 ? "Player 1 led" : "Player 2 led";
  return (
    <section className="mt-5 rounded-2xl border border-primary/20 bg-primary/5 p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="eyebrow">
            <Sparkles className="h-3.5 w-3.5" /> Analysis summary
          </p>
          <h2 className="mt-1 font-display text-xl font-semibold">
            Your video, distilled into a plan.
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Start with the signal, then open individual moments when you want the detail.
          </p>
        </div>
        <Target className="mt-1 h-5 w-5 text-primary" />
      </div>
      <div className="mt-5 grid gap-2 sm:grid-cols-3">
        <SummaryMetric
          icon={<Trophy />}
          label={isTrackNet && !hasTrackNetScore ? "Detector" : "Result"}
          value={isTrackNet && !hasTrackNetScore ? "TrackNet ready" : winner}
          detail={
            isTrackNet && !hasTrackNetScore ? "Processed video ready" : `${score.p1}-${score.p2}`
          }
        />
        <SummaryMetric
          icon={<ListVideo />}
          label={isTrackNet && !hasTrackNetScore ? "Shuttle detections" : "Key moments"}
          value={`${isTrackNet && !hasTrackNetScore ? tracknetDetections.length : rallies.length}`}
          detail={isTrackNet && !hasTrackNetScore ? "frames detected" : "rallies detected"}
        />
        <SummaryMetric
          icon={<Clock3 />}
          label="AI confidence"
          value={`${confidence}%`}
          detail={`${isTrackNet ? tracknetDetections.length : detected} AI checks`}
        />
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-primary/15 bg-background/30 p-3">
          <p className="text-xs font-semibold text-primary">What went well</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            {isTrackNet && hasTrackNetScore
              ? `TrackNet found ${rallies.length} visible rally endings and assigned each point automatically. Off-camera clears are not counted.`
              : isTrackNet
                ? "The processed video is ready with TrackNet shuttle markers for review."
                : "Your strongest moments are now grouped in the timeline so you can revisit successful rallies."}
          </p>
        </div>
        <div className="rounded-xl border border-white/10 bg-background/30 p-3">
          <p className="text-xs font-semibold text-primary">Next drill</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            {isTrackNet && hasTrackNetScore
              ? getNextPracticeSuggestion(rallies)
              : isTrackNet
                ? "Review the processed video and confirm the court corners before scoring."
                : getNextPracticeSuggestion(rallies)}
          </p>
        </div>
      </div>
    </section>
  );
}

function getNextPracticeSuggestion(rallies: Rally[]) {
  if (!rallies.length) return "Upload a longer clip to generate a more specific drill.";
  const outCount = rallies.filter((r) => !r.inBounds).length;
  const lowConfidence = rallies.filter((r) => r.aiConfidence > 0 && r.aiConfidence < 0.8).length;
  const labeled = rallies.filter((r) => r.shotType && r.shotType !== "unknown");
  if (outCount / rallies.length > 0.35)
    return "Practice control first: play half-court clears and aim for three landing zones before adding pace.";
  if (lowConfidence >= 2)
    return "Improve the camera angle and repeat the clip with the full court visible so the AI can track more confidently.";
  if (labeled.length >= 3)
    return `Repeat your ${labeled[labeled.length - 1].shotType} pattern, then add one recovery step after every shot.`;
  return "Review the longest rally, label the key shot manually, and repeat that movement pattern in your next session.";
}
function SummaryMetric({
  icon,
  label,
  value,
  detail,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-background/30 p-3">
      <div className="flex items-center gap-2 text-primary">
        <span className="h-3.5 w-3.5">{icon}</span>
        <span className="text-[10px] font-semibold uppercase tracking-wider">{label}</span>
      </div>
      <p className="mt-2 text-lg font-bold">{value}</p>
      <p className="text-[10px] text-muted-foreground">{detail}</p>
    </div>
  );
}

function ScoreCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-1 text-4xl font-bold tabular-nums">{value}</p>
    </div>
  );
}

function drawCornersOverlay(ctx: CanvasRenderingContext2D, corners: Point[], w: number, h: number) {
  if (corners.length > 0) {
    ctx.strokeStyle = "rgba(250, 204, 21, 0.8)";
    ctx.fillStyle = "rgba(250, 204, 21, 0.25)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    corners.forEach((c, i) => {
      if (i === 0) ctx.moveTo(c.x, c.y);
      else ctx.lineTo(c.x, c.y);
    });
    if (corners.length === 4) ctx.closePath();
    ctx.stroke();
    if (corners.length === 4) ctx.fill();
  }
  corners.forEach((c, i) => {
    ctx.fillStyle = "#facc15";
    ctx.beginPath();
    ctx.arc(c.x, c.y, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#000";
    ctx.font = "bold 11px sans-serif";
    ctx.fillText(String(i + 1), c.x - 3, c.y + 4);
  });
  // Guide crosshairs at frame edges
  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, h / 2);
  ctx.lineTo(w, h / 2);
  ctx.moveTo(w / 2, 0);
  ctx.lineTo(w / 2, h);
  ctx.stroke();
}

function formatTime(s: number) {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}
