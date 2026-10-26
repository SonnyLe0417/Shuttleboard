import { createFileRoute } from "@tanstack/react-router";
import { requestVision } from "@/lib/vision-request";
import { useEffect, useMemo, useRef, useState } from "react";
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
import {
  createTrackNetPreview,
  getTrackNetHealth,
  type TrackNetPoint,
  type TrackNetSettings,
} from "@/lib/tracknet-client";
import { isSupportedVideo } from "@/lib/video-upload";
import type { AnalysisRally } from "@/lib/analysis-results";
import {
  acquireAnalyzerLock,
  cancellationMessage,
  createFreshAnalyzerState,
  showsPlaybackControl,
} from "@/lib/video-analyzer-flow";
import {
  correctRally as applyRallyCorrection,
  landingAmbiguityReasons,
  setRallyReviewStatus,
} from "@/lib/analysis-results";
import { type GameMode, rallyLanding } from "@/lib/badminton";
import {
  DEFAULT_VIDEO_MATCH_SETTINGS,
  resolveVideoMatch,
  videoMatchOptions,
  type VideoMatchSettings,
} from "@/lib/video-match";
import {
  createRallyEndState,
  updateRallyEndState,
  type RallyEndEvent,
} from "@/lib/rally-end-detector";
import { buildTrackNetRallies } from "@/lib/tracknet-rallies";
import {
  summarizeTrackNetFrames,
  trackNetVisualTrail,
  type TrackNetFrameDiagnostics,
} from "@/lib/tracknet-evidence";
import { useTrackNetAnalysis } from "@/components/TrackNetAnalysisProvider";
import { VideoUploadPanel } from "@/components/video/VideoUploadPanel";
import { VideoPreviewPanel } from "@/components/video/VideoPreviewPanel";
import { CourtCalibrationPanel } from "@/components/video/CourtCalibrationPanel";
import { AnalysisProgressPanel } from "@/components/video/AnalysisProgressPanel";
import { AnalysisResultsPanel } from "@/components/video/AnalysisResultsPanel";
import { AnalysisControlsPanel } from "@/components/video/AnalysisControlsPanel";
import { VideoMatchPanel } from "@/components/video/VideoMatchPanel";
import { cornersForPlayerOne } from "@/lib/vision-geometry";
import { previewFailureMessage, shouldCreateBrowserPreview } from "@/lib/video-preview";
import {
  addCourtCorner,
  courtDestinationCorners,
  hasFourCourtCorners,
  loadCourtCalibration,
  pointFromCanvasClick,
  saveCourtCalibration,
} from "@/lib/court-calibration";
import {
  clearVideoAnalysisSession,
  createVideoSessionKey,
  loadVideoAnalysisSession,
  saveVideoAnalysisSession,
} from "@/lib/video-analysis-session";
import {
  closeCameraSegment,
  createCameraMotionState,
  createCameraSegment,
  updateCameraMotion,
  type CameraViewType,
} from "@/lib/video-camera-segments";

export const Route = createFileRoute("/_authenticated/video")({
  head: () => ({
    meta: [
      { title: "Video analysis · ShuttleBoard" },
      {
        name: "description",
        content: "Upload a match video, mark the court, and auto-track the shuttle and score.",
      },
      { property: "og:title", content: "Video analysis · ShuttleBoard" },
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
const DEFAULT_TRACKNET_SETTINGS: TrackNetSettings = {
  backend: "openvino",
  device: "CPU",
  evalMode: "weight",
  inpaint: false,
  intraThreads: 8,
};

function formatEta(seconds: number | null | undefined) {
  if (!seconds || !Number.isFinite(seconds) || seconds <= 0) return null;
  const rounded = Math.ceil(seconds);
  if (rounded < 60) return `${rounded}s`;
  const minutes = Math.floor(rounded / 60);
  const remainingSeconds = rounded % 60;
  return remainingSeconds ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
}

function VideoAnalyzerPage() {
  const [phase, setPhase] = useState<Phase>("upload");
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [tracknetVideoUrl, setTracknetVideoUrl] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [videoSessionKey, setVideoSessionKey] = useState<string | null>(null);
  const [analysisMode, setAnalysisMode] = useState<"browser" | "tracknet">("browser");
  const [tracknetSettings, setTracknetSettings] =
    useState<TrackNetSettings>(DEFAULT_TRACKNET_SETTINGS);
  const [tracknetEngine, setTracknetEngine] = useState<"current" | "v3" | "unknown">("unknown");
  const [tracknetPoints, setTracknetPoints] = useState<TrackNetPoint[]>([]);
  const [frameDiagnostics, setFrameDiagnostics] = useState<TrackNetFrameDiagnostics | null>(null);
  const [corners, setCorners] = useState<Point[]>([]); // in displayed pixel space of the calibrate canvas
  const [netCorners, setNetCorners] = useState<Point[]>([]);
  const [calibrationTarget, setCalibrationTarget] = useState<"court" | "net">("court");
  const [viewType, setViewType] = useState<CameraViewType>("birds-eye");
  const [cameraSegments, setCameraSegments] = useState<ReturnType<typeof createCameraSegment>[]>(
    [],
  );
  const [cameraChangePending, setCameraChangePending] = useState(false);
  const [displaySize, setDisplaySize] = useState({ w: 0, h: 0 });
  const [playing, setPlaying] = useState(false);
  const [rallies, setRallies] = useState<Rally[]>([]);
  const [matchSettings, setMatchSettings] = useState<VideoMatchSettings>(
    DEFAULT_VIDEO_MATCH_SETTINGS,
  );
  const [gameMode, setGameMode] = useState<GameMode>("singles");
  // Winners, games and ends are derived from the rally list on every change.
  const match = useMemo(
    () => resolveVideoMatch(rallies, videoMatchOptions(matchSettings)),
    [rallies, matchSettings],
  );
  const score = match.score;
  const [status, setStatus] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [paidAiNotice, setPaidAiNotice] = useState<string | null>(null);
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
  const lastVisibleRef = useRef<{ x: number; y: number; t: number } | null>(null);
  const rallyEndStateRef = useRef(createRallyEndState());
  // The browser analysis loop is set up once per phase, so it reads these through refs.
  const matchRef = useRef(match);
  const lastHitterRef = useRef(lastHitter);
  const gameModeRef = useRef(gameMode);
  const aiPendingRef = useRef(false);
  const tracknetPointsRef = useRef<TrackNetPoint[]>([]);
  const previewAttemptedRef = useRef(false);
  const cameraMotionRef = useRef(createCameraMotionState());
  const rafRef = useRef<number>(0);
  const processedJobIdRef = useRef<string | null>(null);
  const reviewedJobIdRef = useRef<string | null>(null);
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
    if (analysisMode !== "tracknet") return;
    void getTrackNetHealth()
      .then((health) => {
        if (health.engine === "v3") setTracknetEngine("v3");
        else if (health.ok) setTracknetEngine("current");
      })
      .catch(() => setTracknetEngine("unknown"));
  }, [analysisMode]);

  useEffect(() => {
    return () => {
      if (videoUrl?.startsWith("blob:")) URL.revokeObjectURL(videoUrl);
    };
  }, [videoUrl]);

  useEffect(() => {
    matchRef.current = match;
    lastHitterRef.current = lastHitter;
    gameModeRef.current = gameMode;
  }, [match, lastHitter, gameMode]);

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
    const saved = loadVideoAnalysisSession(window.sessionStorage);
    if (!saved) return;

    setVideoSessionKey(saved.videoKey);
    setAnalysisMode(saved.analysisMode);
    setRallies(saved.rallies);
    setMatchSettings(saved.matchSettings ?? DEFAULT_VIDEO_MATCH_SETTINGS);
    setGameMode(saved.gameMode ?? "singles");
    reviewedJobIdRef.current = saved.tracknetJobId ?? null;
    setFrameDiagnostics(saved.tracknetFrameDiagnostics ?? null);
    setTracknetVideoUrl(saved.processedVideoUrl);
    setVideoUrl(saved.processedVideoUrl);
    setPhase("done");
    setStatus("Restored your review choices for this video.");
  }, []);

  useEffect(() => {
    if (phase !== "done" || !videoSessionKey) return;

    saveVideoAnalysisSession(window.sessionStorage, {
      videoKey: videoSessionKey,
      rallies,
      score,
      processedVideoUrl: tracknetVideoUrl,
      analysisMode,
      tracknetJobId: reviewedJobIdRef.current ?? undefined,
      tracknetFrameDiagnostics: frameDiagnostics ?? undefined,
      matchSettings,
      gameMode,
    });
  }, [
    analysisMode,
    phase,
    rallies,
    score,
    tracknetVideoUrl,
    videoSessionKey,
    frameDiagnostics,
    matchSettings,
    gameMode,
  ]);

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
      if (processedJobIdRef.current === tracknetResult.job_id) return;
      const saved = loadVideoAnalysisSession(window.sessionStorage);
      processedJobIdRef.current = tracknetResult.job_id;
      reviewedJobIdRef.current = tracknetResult.job_id;
      analysisStartLockRef.current = false;
      setAnalysisStarting(false);
      retryLockRef.current = false;
      setRetrying(false);
      setTracknetPoints(tracknetResult.coordinates);
      tracknetPointsRef.current = tracknetResult.coordinates;
      setFrameDiagnostics(summarizeTrackNetFrames(tracknetResult.coordinates));
      const scoredRallies =
        saved?.tracknetJobId === tracknetResult.job_id
          ? saved.rallies
          : homographyRef.current
            ? buildTrackNetRallies(tracknetResult.coordinates, homographyRef.current, {
                mode: gameModeRef.current,
              })
            : [];
      setRallies(scoredRallies);
      setTracknetVideoUrl(tracknetResult.video_url);
      setVideoUrl(tracknetResult.video_url);
      setPhase("done");
      setStatus(
        `TrackNet complete: ${tracknetResult.frames} frames analyzed and ${scoredRallies.length} possible rally endings found.`,
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
    setRallies((current) => applyRallyCorrection(current, id, patch));
  };
  const setReviewStatus = (
    id: number,
    reviewStatus: "needs-review" | "confirmed" | "corrected",
  ) => {
    // Confirming keeps the winner the reviewer was shown.
    const shown = match.rallies.find((rally) => rally.id === id)?.winner;
    setRallies((current) => setRallyReviewStatus(current, id, reviewStatus, shown));
  };
  const onFile = (file: File) => {
    setError(null);
    if (!isSupportedVideo(file)) {
      setError("Please upload a video file.");
      return;
    }
    clearVideoAnalysisSession(window.sessionStorage);
    const url = URL.createObjectURL(file);
    analysisStartLockRef.current = false;
    retryLockRef.current = false;
    setAnalysisStarting(false);
    setRetrying(false);
    clearTrackNet();
    setSelectedFile(file);
    setVideoSessionKey(createVideoSessionKey(file));
    previewAttemptedRef.current = false;
    setVideoUrl(url);
    setTracknetVideoUrl(null);
    setTracknetPoints([]);
    tracknetPointsRef.current = [];
    setCorners([]);
    setNetCorners([]);
    setCameraSegments([]);
    setCameraChangePending(false);
    cameraMotionRef.current = createCameraMotionState();
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
    rallyEndStateRef.current = createRallyEndState();
    lastVisibleRef.current = null;
    processedJobIdRef.current = null;
    reviewedJobIdRef.current = null;
    setFrameDiagnostics(null);
    setRallies([]);
    setPlaying(false);
    setStatus("");
    setError(null);
    setSelectedRally(null);
    clearVideoAnalysisSession(window.sessionStorage);
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
    await startTrackNet(selectedFile, tracknetSettings);
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
      drawCornersOverlay(ctx, corners, w, h, netCorners);
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
  }, [phase, corners, netCorners]);

  const onCalibClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const point = pointFromCanvasClick(
      e.clientX,
      e.clientY,
      rect,
      e.currentTarget.width,
      e.currentTarget.height,
    );
    if (calibrationTarget === "net") {
      setNetCorners((current) => addCourtCorner(current, point));
    } else {
      setCorners((current) => addCourtCorner(current, point));
    }
  };

  const startAnalysis = () => {
    requestVision.resume();
    setPaidAiNotice(null);
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
    const currentTime = video.currentTime;
    const normalizedNetCorners = netCorners.map((point) => ({
      x: point.x / displaySize.w,
      y: point.y / displaySize.h,
    }));

    if (cameraChangePending && homographyRef.current) {
      setCameraSegments((current) => [
        ...closeCameraSegment(current, currentTime),
        createCameraSegment(
          current.length + 1,
          currentTime,
          viewType,
          normCorners,
          normalizedNetCorners,
          homographyRef.current!,
        ),
      ]);
      cameraMotionRef.current = createCameraMotionState();
      setCameraChangePending(false);
      setPhase("analyze");
      setStatus("Camera view updated. Scoring resumed.");
      void video.play().then(() => setPlaying(true));
      analysisStartLockRef.current = false;
      setAnalysisStarting(false);
      return;
    }

    if (homographyRef.current) {
      setCameraSegments([
        createCameraSegment(
          1,
          currentTime,
          viewType,
          normCorners,
          normalizedNetCorners,
          homographyRef.current,
        ),
      ]);
    }
    cameraMotionRef.current = createCameraMotionState();
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
    const cameraMotion = updateCameraMotion(cameraMotionRef.current, detection.cameraShift, t);
    cameraMotionRef.current = cameraMotion.state;
    if (cameraMotion.needsRecalibration && !cameraChangePending) {
      video.pause();
      setPlaying(false);
      setCameraChangePending(true);
      setCorners([]);
      setNetCorners([]);
      setCalibrationTarget("court");
      setStatus("Camera movement detected. Mark the four new court corners to continue.");
      setPhase("calibrate");
      return;
    }
    const track = detection.track;
    // Only fresh detections are evidence. While the tracker coasts it projects
    // the old velocity, which runs past the real landing.
    const visibleNow = Boolean(
      track &&
      track.visible &&
      track.confidence > LOCAL_TRACK_MIN_CONFIDENCE &&
      track.lastSeen === now,
    );

    if (visibleNow && track) {
      lastVisibleRef.current = { x: track.x, y: track.y, t };
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
    }

    const endResult = updateRallyEndState(rallyEndStateRef.current, {
      time: t,
      x: visibleNow && track ? track.x : null,
      y: visibleNow && track ? track.y : null,
      visible: visibleNow,
      confidence: track?.confidence ?? 0,
      cameraStable: !cameraMotion.needsRecalibration,
      playerMotion: Math.min(1, (detection.motionPixels / (work.width * work.height)) * 4),
    });
    rallyEndStateRef.current = endResult.state;
    if (endResult.event && !aiPendingRef.current) {
      void endRally(endResult.event);
    }

    drawOverlay();
  }

  const endRally = async (event: RallyEndEvent) => {
    const video = videoRef.current;
    const eventPoint = event.point;
    const last =
      eventPoint.x !== null && eventPoint.y !== null
        ? { x: eventPoint.x, y: eventPoint.y, t: eventPoint.time }
        : lastVisibleRef.current;
    const H = homographyRef.current;
    if (!video || !last || !H) return;
    aiPendingRef.current = true;
    const wasPlaying = !video.paused;
    if (wasPlaying) {
      video.pause();
      setPlaying(false);
    }

    // Local decision from homography, with the same in/out rule as TrackNet.
    // Players are attributed to ends later by the match timeline.
    const court = applyHomography(H, { x: last.x, y: last.y });
    const mode = gameModeRef.current;
    const landing = rallyLanding(court.x, court.y, mode);
    const near = matchRef.current.timeline.near;
    const endOwner = landing.end === "near" ? near : near === "p1" ? "p2" : "p1";
    let winner: "p1" | "p2" = landing.isIn ? (endOwner === "p1" ? "p2" : "p1") : endOwner;
    let winnerLocked = false;
    const reasons = [
      ...event.reasons,
      ...(event.landingSeen ? landingAmbiguityReasons(court.x, court.y, mode) : []),
    ];
    const needsReview = event.type === "needs-review" || reasons.length > 0;
    let aiConf = eventPoint.confidence;
    let aiNote = needsReview ? reasons.join(" ") : "Auto-decided from tracker.";

    // AI double-check: send a capture of the current frame + last position.
    try {
      if (needsReview || !requestVision.canSample()) throw new Error("Paid review unavailable.");
      const cap = document.createElement("canvas");
      cap.width = 640;
      cap.height = Math.round((640 * video.videoHeight) / video.videoWidth);
      const cctx = cap.getContext("2d");
      if (cctx) {
        cctx.drawImage(video, 0, 0, cap.width, cap.height);
        const dataUrl = cap.toDataURL("image/jpeg", 0.7);
        const resp = await requestVision({
          image: dataUrl,
          mode,
          p1Side: near === "p1" ? "bottom" : "top",
          courtCorners: cornersForPlayerOne(normalizedCornersRef.current, near === "p1"),
          lastHitter: lastHitterRef.current,
        });
        if (resp.ok) {
          const j = await resp.json();
          if (j && (j.pointTo === "p1" || j.pointTo === "p2") && j.confidence >= 0.75) {
            winner = j.pointTo;
            winnerLocked = true;
            aiConf = j.confidence;
            aiNote = j.reasoning ?? "AI confirmed";
          }
        } else {
          const failure = await resp.json();
          setPaidAiNotice(failure.error || "Paid AI is paused; local results remain available.");
        }
      }
    } catch {
      // ignore AI failure — fall back to local decision
    }

    setRallies((r) => [
      ...r,
      {
        id: r.length + 1,
        t: event.landingTime,
        landingImgX: last.x,
        landingImgY: last.y,
        landingCourtX: court.x,
        landingCourtY: court.y,
        inBounds: landing.isIn,
        winner,
        winnerLocked,
        landingEnd: event.landingSeen ? landing.end : undefined,
        landingSeen: event.landingSeen,
        aiConfidence: aiConf,
        aiNote,
        needsReview,
        reviewReasons: reasons,
        countsTowardScore: !needsReview,
        reviewStatus: needsReview ? "needs-review" : undefined,
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
      const recentPoints = trackNetVisualTrail(tracknetPointsRef.current, currentTime);
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
      const currentPoint = recentPoints[recentPoints.length - 1];
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
    clearVideoAnalysisSession(window.sessionStorage);
    setSelectedFile(null);
    setVideoSessionKey(null);
    setAnalysisMode("browser");
    setPhase(fresh.phase);
    setVideoUrl(fresh.videoUrl);
    setTracknetVideoUrl(fresh.tracknetVideoUrl);
    setTracknetPoints(fresh.tracknetPoints);
    tracknetPointsRef.current = fresh.tracknetPoints;
    setCorners(fresh.corners as Point[]);
    setNetCorners([]);
    setCameraSegments([]);
    setCameraChangePending(false);
    setCalibrationTarget("court");
    setViewType("birds-eye");
    cameraMotionRef.current = createCameraMotionState();
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
      autoPlay={phase === "calibrate" && !cameraChangePending}
      onError={handleVideoError}
      onCalibrationClick={onCalibClick}
      onLoadedMetadata={syncTrackNetOverlay}
      onTimeUpdate={() => {
        if (analysisMode === "tracknet") drawOverlay();
      }}
    />
  ) : null;

  return (
    <div className="club-video-page">
      <div className="mb-4">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          A fresh look at your game
        </p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">There’s a story in every rally.</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Upload a match, set the court, then review the rallies. You make the final call.
        </p>
        <nav className="club-video-steps" aria-label="Analysis workflow">
          <WorkflowStep
            active={phase === "upload"}
            done={phase !== "upload"}
            number="01"
            label="Upload"
          />
          <WorkflowStep
            active={phase === "calibrate"}
            done={phase === "analyze" || phase === "done"}
            number="02"
            label="Set court"
          />
          <WorkflowStep
            active={phase === "analyze"}
            done={phase === "done"}
            number="03"
            label="Analyze"
          />
          <WorkflowStep active={phase === "done"} done={false} number="04" label="Review" />
        </nav>
      </div>

      {error && phase !== "calibrate" && phase !== "analyze" && phase !== "done" && (
        <div className="mb-3 flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertCircle className="h-4 w-4" /> {error}
        </div>
      )}

      {paidAiNotice && (
        <p role="status" className="mb-3 rounded-md border p-3 text-sm">
          {paidAiNotice}
        </p>
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

      <div className={phase === "analyze" || phase === "done" ? "club-analysis-layout" : ""}>
        <div className="club-analysis-video">
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
              viewType={viewType}
              onViewTypeChange={setViewType}
              netCorners={netCorners}
              calibrationTarget={calibrationTarget}
              onCalibrationTargetChange={setCalibrationTarget}
              onResetNetCorners={() => setNetCorners([])}
              cameraSegments={cameraSegments}
              cameraChangePending={cameraChangePending}
              currentTime={videoRef.current?.currentTime ?? 0}
              tracknetSettings={tracknetSettings}
              onTrackNetSettingsChange={setTracknetSettings}
              tracknetEngine={tracknetEngine}
              gameMode={gameMode}
              onGameModeChange={setGameMode}
            />
          )}
          {phase === "done" && <CameraTimeline segments={cameraSegments} />}
        </div>
        <div className="club-analysis-review">
          {(phase === "analyze" || phase === "done") && (
            <>
              <VideoMatchPanel
                match={match}
                settings={matchSettings}
                onSettingsChange={setMatchSettings}
              />

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
                <>
                  <AnalysisResultsPanel
                    rallies={match.rallies}
                    match={match}
                    tracknetPoints={analysisMode === "tracknet" ? tracknetPoints : undefined}
                    frameDiagnostics={frameDiagnostics ?? undefined}
                    processedVideoUrl={tracknetVideoUrl}
                    selectedRally={selectedRally}
                    onSelectRally={(rally) => {
                      setSelectedRally(rally.id);
                      if (videoRef.current) videoRef.current.currentTime = rally.t;
                    }}
                    onCorrectRally={correctRally}
                    onSetReviewStatus={setReviewStatus}
                  />
                </>
              )}
            </>
          )}
        </div>
      </div>
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
      aria-current={active ? "step" : undefined}
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

function CameraTimeline({ segments }: { segments: ReturnType<typeof createCameraSegment>[] }) {
  if (!segments.length) return null;
  return (
    <div className="mt-4 rounded-xl border border-border bg-card p-4">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Camera timeline
      </p>
      <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
        {segments.map((segment) => (
          <span key={segment.id} className="rounded-md border border-border px-2 py-1">
            View {segment.id}: {segment.viewType === "birds-eye" ? "Birds-eye" : "Side-angle"} ·{" "}
            {segment.startTime.toFixed(1)}s
            {segment.endTime === null ? "–end" : `–${segment.endTime.toFixed(1)}s`}
          </span>
        ))}
      </div>
    </div>
  );
}

function drawCornersOverlay(
  ctx: CanvasRenderingContext2D,
  corners: Point[],
  w: number,
  h: number,
  netCorners: Point[] = [],
) {
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
  if (netCorners.length > 0) {
    ctx.strokeStyle = "rgba(34, 211, 238, 0.9)";
    ctx.fillStyle = "rgba(34, 211, 238, 0.15)";
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    netCorners.forEach((c, i) => {
      if (i === 0) ctx.moveTo(c.x, c.y);
      else ctx.lineTo(c.x, c.y);
    });
    if (netCorners.length === 4) ctx.closePath();
    ctx.stroke();
    if (netCorners.length === 4) ctx.fill();
    ctx.setLineDash([]);
    netCorners.forEach((c, i) => {
      ctx.fillStyle = "#22d3ee";
      ctx.beginPath();
      ctx.arc(c.x, c.y, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#000";
      ctx.font = "bold 10px sans-serif";
      ctx.fillText(`N${i + 1}`, c.x - 7, c.y + 4);
    });
  }
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
