import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { AlertCircle, CheckCircle2 } from "lucide-react";
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
import type { AnalysisRally, ShotType } from "@/lib/analysis-results";
import {
  acquireAnalyzerLock,
  cancellationMessage,
  createFreshAnalyzerState,
  showsPlaybackControl,
} from "@/lib/video-analyzer-flow";
import {
  getRallyReviewReasons,
  rallyCountsTowardScore,
  setRallyReviewStatus,
} from "@/lib/analysis-results";
import { useTrackNetAnalysis } from "@/components/TrackNetAnalysisProvider";
import { VideoUploadPanel } from "@/components/video/VideoUploadPanel";
import { VideoPreviewPanel } from "@/components/video/VideoPreviewPanel";
import { CourtCalibrationPanel } from "@/components/video/CourtCalibrationPanel";
import { AnalysisProgressPanel } from "@/components/video/AnalysisProgressPanel";
import { AnalysisResultsPanel } from "@/components/video/AnalysisResultsPanel";
import { AnalysisControlsPanel } from "@/components/video/AnalysisControlsPanel";
import { previewFailureMessage, shouldCreateBrowserPreview } from "@/lib/video-preview";
import {
  addCourtCorner,
  courtDestinationCorners,
  hasFourCourtCorners,
  loadCourtCalibration,
  pointFromCanvasClick,
  saveCourtCalibration,
} from "@/lib/court-calibration";

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
type Rally = AnalysisRally;

interface TrailPt {
  x: number;
  y: number;
  t: number;
}

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
  if (visiblePoints.length < 3) return [];

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
    if (segment.length < 3) {
      return;
    }
    const first = segment[0];
    const last = segment[segment.length - 1];
    const offCamera = endsOffCamera(segment);

    const court = applyHomography(homography, { x: last.x, y: last.y });
    const inBounds = court.x >= -0.02 && court.x <= 1.02 && court.y >= -0.02 && court.y <= 1.02;
    // A shuttle landing on the near half gives the point to the far player;
    // landing on the far half gives it to the near player.
    const winner: "p1" | "p2" = court.y > 0.5 ? "p2" : "p1";
    const confidence = segment.reduce((sum, point) => sum + point.confidence, 0) / segment.length;
    const evidenceFrames = segment.length;
    const reviewReasons = getRallyReviewReasons({
      aiConfidence: confidence,
      evidenceFrames,
      offCamera,
      landingCourtX: court.x,
      landingCourtY: court.y,
    });
    if (last.time - first.time < 0.4) reviewReasons.push("The landing evidence is too brief.");

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
      aiNote: reviewReasons.length
        ? reviewReasons.join(" ")
        : "TrackNet auto-scored from visible landing evidence and court side.",
      evidenceFrames,
      offCamera,
      needsReview: reviewReasons.length > 0,
      reviewReasons,
      countsTowardScore: !offCamera,
      reviewStatus: reviewReasons.length ? "needs-review" : undefined,
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
  const [analysisStarting, setAnalysisStarting] = useState(false);
  const [retrying, setRetrying] = useState(false);

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
  const analysisStartLockRef = useRef(false);
  const retryLockRef = useRef(false);
  const {
    start: startTrackNet,
    clear: clearTrackNet,
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
    const calibration = loadCourtCalibration(
      window.localStorage.getItem(TRACKNET_COURT_STORAGE_KEY),
    );
    if (calibration) {
      normalizedCornersRef.current = calibration.corners;
      homographyRef.current = calibration.homography;
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
      if (tracknetResult.job_id !== tracknetJob.jobId) return;
      analysisStartLockRef.current = false;
      setAnalysisStarting(false);
      retryLockRef.current = false;
      setRetrying(false);
      setTracknetPoints(tracknetResult.coordinates);
      tracknetPointsRef.current = tracknetResult.coordinates;
      const scoredRallies = homographyRef.current
        ? buildTrackNetRallies(tracknetResult.coordinates, homographyRef.current)
        : [];
      const scored = scoredRallies.reduce(
        (currentScore, rally) => ({
          p1: currentScore.p1 + (rallyCountsTowardScore(rally) && rally.winner === "p1" ? 1 : 0),
          p2: currentScore.p2 + (rallyCountsTowardScore(rally) && rally.winner === "p2" ? 1 : 0),
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
      analysisStartLockRef.current = false;
      setAnalysisStarting(false);
      retryLockRef.current = false;
      setRetrying(false);
      setPhase(selectedFile ? "calibrate" : "upload");
      setStatus("");
      setError(null);
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
      if (patch.winner && patch.winner !== previous.winner && rallyCountsTowardScore(previous)) {
        scoreRef.current = {
          p1: scoreRef.current.p1 + (patch.winner === "p1" ? 1 : -1),
          p2: scoreRef.current.p2 + (patch.winner === "p2" ? 1 : -1),
        };
        setScore({ ...scoreRef.current });
      }
      return current.map((r) =>
        r.id === id
          ? {
              ...r,
              ...patch,
              manuallyCorrected: true,
              reviewStatus: "corrected",
            }
          : r,
      );
    });
  };
  const setReviewStatus = (
    id: number,
    reviewStatus: "needs-review" | "confirmed" | "corrected",
  ) => {
    setRallies((current) => setRallyReviewStatus(current, id, reviewStatus));
  };
  const onFile = (file: File) => {
    setError(null);
    if (!file.type.startsWith("video/")) {
      setError("Please upload a video file.");
      return;
    }
    const url = URL.createObjectURL(file);
    analysisStartLockRef.current = false;
    retryLockRef.current = false;
    setAnalysisStarting(false);
    setRetrying(false);
    clearTrackNet();
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
    if (!selectedFile || !shouldCreateBrowserPreview(selectedFile, previewAttemptedRef.current)) {
      setError(previewFailureMessage());
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
          previewFailureMessage(previewError instanceof Error ? previewError.message : undefined),
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
    setPlaying(false);
    setStatus("");
    setError(null);
    setSelectedRally(null);
  };

  const runTrackNetAnalysis = async () => {
    if (
      !selectedFile ||
      tracknetPhase === "uploading" ||
      tracknetPhase === "queued" ||
      tracknetPhase === "processing"
    )
      return;
    setError(null);
    setStatus("Uploading video to TrackNet…");
    setPhase("analyze");
    await startTrackNet(selectedFile);
  };

  const retryAnalysis = () => {
    if (!acquireAnalyzerLock(retryLockRef.current)) return;
    retryLockRef.current = true;
    setRetrying(true);
    if (analysisMode === "tracknet") {
      void runTrackNetAnalysis();
      return;
    }
    startAnalysis();
    retryLockRef.current = false;
    setRetrying(false);
  };

  const cancelAnalysis = () => {
    clearTrackNet();
    cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;
    videoRef.current?.pause();
    analysisStartLockRef.current = false;
    retryLockRef.current = false;
    setAnalysisStarting(false);
    setRetrying(false);
    setTracknetVideoUrl(null);
    setTracknetPoints([]);
    tracknetPointsRef.current = [];
    resetAnalysisState();
    setPhase(selectedFile ? "calibrate" : "upload");
    setStatus(cancellationMessage());
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
    const point = pointFromCanvasClick(
      e.clientX,
      e.clientY,
      rect,
      e.currentTarget.width,
      e.currentTarget.height,
    );
    setCorners((current) => addCourtCorner(current, point));
  };

  const startAnalysis = () => {
    if (!acquireAnalyzerLock(analysisStartLockRef.current)) return;
    if (!selectedFile) {
      setError("Upload a video before starting analysis.");
      return;
    }
    if (!hasFourCourtCorners(corners)) {
      setError("Select all four court corners before starting analysis.");
      return;
    }
    const video = videoRef.current;
    if (!video) {
      setError("The video is not ready yet. Please wait and try again.");
      return;
    }
    analysisStartLockRef.current = true;
    setAnalysisStarting(true);
    setError(null);
    // Normalize corner coordinates to 0..1 image space so homography works
    // for the small detection canvas too.
    const normCorners = corners.map((c) => ({
      x: c.x / displaySize.w,
      y: c.y / displaySize.h,
    }));
    normalizedCornersRef.current = normCorners;
    // Map to a normalized court where near baseline is at cy=1, far at cy=0.
    const dst = courtDestinationCorners();
    homographyRef.current = computeHomography(normCorners, dst);
    if (analysisMode === "tracknet" && homographyRef.current) {
      try {
        const saved = saveCourtCalibration(normCorners, homographyRef.current);
        if (saved) window.localStorage.setItem(TRACKNET_COURT_STORAGE_KEY, saved);
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
      analysisStartLockRef.current = false;
      setAnalysisStarting(false);
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
      analysisStartLockRef.current = false;
      setAnalysisStarting(false);
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

  function processFrame() {
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
  }

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
    const fresh = createFreshAnalyzerState();
    clearTrackNet();
    setSelectedFile(null);
    setAnalysisMode("browser");
    setPhase(fresh.phase);
    setVideoUrl(fresh.videoUrl);
    setTracknetVideoUrl(fresh.tracknetVideoUrl);
    setTracknetPoints(fresh.tracknetPoints);
    tracknetPointsRef.current = fresh.tracknetPoints;
    setCorners(fresh.corners as Point[]);
    resetAnalysisState();
    setError(fresh.error);
  };

  const videoPreview = videoUrl ? (
    <VideoPreviewPanel
      videoRef={videoRef}
      calibrationCanvasRef={calibCanvasRef}
      overlayRef={overlayRef}
      src={tracknetVideoUrl ?? videoUrl}
      calibrating={phase === "calibrate"}
      autoPlay={phase === "calibrate"}
      onError={handleVideoError}
      onCalibrationClick={onCalibClick}
      onLoadedMetadata={syncTrackNetOverlay}
      onTimeUpdate={() => {
        if (analysisMode === "tracknet") drawOverlay();
      }}
    />
  ) : null;

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

      {error && phase !== "calibrate" && phase !== "analyze" && phase !== "done" && (
        <div className="mb-3 flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertCircle className="h-4 w-4" /> {error}
        </div>
      )}

      <AnalysisProgressPanel
        phase={tracknetPhase}
        progress={tracknetProgress}
        etaSeconds={tracknetEtaSeconds}
        error={tracknetError}
        onRetry={retryAnalysis}
        retrying={retrying}
        onCancel={cancelAnalysis}
      />

      {phase === "upload" && <VideoUploadPanel onFile={onFile} />}

      {phase !== "upload" && videoUrl && (
        <>
          {phase !== "calibrate" && videoPreview}
          <canvas ref={workRef} className="hidden" />
        </>
      )}

      {phase === "calibrate" && (
        <CourtCalibrationPanel
          corners={corners}
          analysisMode={analysisMode}
          preview={videoPreview}
          onReset={() => setCorners([])}
          onModeChange={setAnalysisMode}
          onStart={startAnalysis}
          starting={analysisStarting}
          message={error}
        />
      )}

      {(phase === "analyze" || phase === "done") && (
        <>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <ScoreCard label="Player 1 (near)" value={score.p1} />
            <ScoreCard label="Player 2 (far)" value={score.p2} />
          </div>

          <AnalysisControlsPanel
            mode={analysisMode}
            showPlayback={showsPlaybackControl(analysisMode, phase)}
            playing={playing}
            status={analysisMode === "browser" ? status : ""}
            error={error}
            lastHitter={lastHitter}
            onTogglePlay={togglePlay}
            onRestart={restart}
            onLastHitterChange={setLastHitter}
            onRetry={retryAnalysis}
            retrying={retrying}
            canCancel={phase === "analyze" && analysisMode === "browser"}
            onCancel={cancelAnalysis}
          />

          {phase === "done" && (
            <AnalysisResultsPanel
              rallies={rallies}
              score={score}
              tracknetPoints={analysisMode === "tracknet" ? tracknetPoints : undefined}
              processedVideoUrl={tracknetVideoUrl}
              selectedRally={selectedRally}
              onSelectRally={(rally) => {
                setSelectedRally(rally.id);
                if (videoRef.current) videoRef.current.currentTime = rally.t;
              }}
              onCorrectRally={correctRally}
              onSetReviewStatus={setReviewStatus}
            />
          )}
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
