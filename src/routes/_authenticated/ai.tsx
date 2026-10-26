import { createFileRoute } from "@tanstack/react-router";
import { requestVision } from "@/lib/vision-request";
import { LiveRally } from "@/lib/live-rally";
import { startLiveFramePump } from "@/lib/live-frame-pump";
import { useState, useRef, useCallback, useEffect } from "react";
import {
  Camera,
  Play,
  Square,
  AlertCircle,
  RotateCcw,
  Lightbulb,
  Crosshair,
  Check,
} from "lucide-react";
import {
  detectBirdieMotion,
  LOCAL_TRACK_MIN_CONFIDENCE,
  LOCAL_TRACK_WIDTH,
  LOCAL_TRACK_COAST_MS,
  type LocalTrack,
} from "@/lib/birdie-tracker";
import {
  BadmintonMatchProvider,
  useSharedBadmintonMatch,
} from "@/components/BadmintonMatchProvider";
import {
  connectLiveTrackNet,
  type LiveTrackNetConnection,
  type LiveTrackNetDetection,
} from "@/lib/tracknet-client";

type CourtPoint = { x: number; y: number };
type TrackingRoi = { x: number; y: number; width: number; height: number };
type CameraRange = { min: number; max: number; step?: number };
type CameraControls = {
  torch: boolean;
  zoom?: CameraRange;
  exposure?: CameraRange;
};
type RefereeMode = "current" | "tracknet";
type TrackNetConnectionStatus = "idle" | "connecting" | "ready" | "error";
type CameraPreset = "1080p60" | "720p60" | "720p30" | "480p30";
const CAMERA_PRESETS: Array<{
  id: CameraPreset;
  label: string;
  width: number;
  height: number;
  fps: number;
}> = [
  { id: "1080p60", label: "1080p · 60 FPS", width: 1920, height: 1080, fps: 60 },
  { id: "720p60", label: "720p · 60 FPS", width: 1280, height: 720, fps: 60 },
  { id: "720p30", label: "720p · 30 FPS", width: 1280, height: 720, fps: 30 },
  { id: "480p30", label: "480p · 30 FPS", width: 854, height: 480, fps: 30 },
];
const CORNER_LABELS = ["P1 back-left", "P1 back-right", "P2 back-right", "P2 back-left"] as const;

export const Route = createFileRoute("/_authenticated/ai")({
  head: () => ({
    meta: [
      { title: "AI Referee — Badminton Game Tracker" },
      {
        name: "description",
        content: "Live camera tracks the shuttle continuously and auto-scores when it lands.",
      },
      { property: "og:title", content: "AI Referee — Badminton Game Tracker" },
      {
        property: "og:description",
        content: "Live camera continuously tracks the shuttle and auto-scores.",
      },
    ],
  }),
  component: AiRoute,
});

function AiRoute() {
  return (
    <BadmintonMatchProvider>
      <AiVisionPage />
    </BadmintonMatchProvider>
  );
}

interface TrackResult {
  shuttleVisible: boolean;
  position: { x: number; y: number };
  landed: boolean;
  call: "in" | "out" | "unknown";
  pointTo: "p1" | "p2" | "none";
  confidence: number;
  reasoning: string;
}

// Trail of past shuttle positions for smoother visual tracking
interface TrailPoint {
  x: number;
  y: number;
  t: number;
}

const ACQUIRE_HITS = 2;
const LANDING_CONFIRMATION_FRAMES = 3;
const LANDING_CONFIRMATION_WINDOW_MS = 1600;
const LANDING_POSITION_TOLERANCE = 0.08;
const LANDING_RELEASE_FRAMES = 3;
const FLIGHT_ZONE_PADDING_X = 0.08;
const FLIGHT_ZONE_PADDING_Y = 0.16;

function expandFlightZone(corners: CourtPoint[]): CourtPoint[] {
  const center = corners.reduce(
    (sum, corner) => ({
      x: sum.x + corner.x / corners.length,
      y: sum.y + corner.y / corners.length,
    }),
    { x: 0, y: 0 },
  );
  return corners.map((corner) => ({
    x: Math.max(0, Math.min(1, corner.x + Math.sign(corner.x - center.x) * FLIGHT_ZONE_PADDING_X)),
    y: Math.max(0, Math.min(1, corner.y + Math.sign(corner.y - center.y) * FLIGHT_ZONE_PADDING_Y)),
  }));
}

function chooseTrackingRoi(track: LocalTrack | null, videoAspect: number): TrackingRoi {
  if (!track) return { x: 0, y: 0, width: 1, height: 1 };
  // A confident lock gets a tight crop; uncertainty automatically widens the
  // crop so prediction errors do not cut the shuttle out of the next frame.
  const uncertainty = track.uncertainty ?? 0.18;
  const width = Math.min(0.78, 0.48 + uncertainty * 0.55);
  const height = Math.min(0.82, width * videoAspect);
  const predictedX = track.x + track.vx * 80 + 0.5 * track.ax * 80 * 80;
  const predictedY = track.y + track.vy * 80 + 0.5 * track.ay * 80 * 80;
  const centerX = Math.max(width / 2, Math.min(1 - width / 2, predictedX));
  const centerY = Math.max(height / 2, Math.min(1 - height / 2, predictedY));
  return { x: centerX - width / 2, y: centerY - height / 2, width, height };
}

function mapTrackToRoi(track: LocalTrack, roi: TrackingRoi): LocalTrack {
  return {
    ...track,
    x: (track.x - roi.x) / roi.width,
    y: (track.y - roi.y) / roi.height,
    vx: track.vx / roi.width,
    vy: track.vy / roi.height,
    ax: track.ax / roi.width,
    ay: track.ay / roi.height,
  };
}

function mapTrackFromRoi(track: LocalTrack, roi: TrackingRoi): LocalTrack {
  return {
    ...track,
    x: Math.max(0, Math.min(1, roi.x + track.x * roi.width)),
    y: Math.max(0, Math.min(1, roi.y + track.y * roi.height)),
    vx: track.vx * roi.width,
    vy: track.vy * roi.height,
    ax: track.ax * roi.width,
    ay: track.ay * roi.height,
  };
}

function mapPolygonToRoi(
  polygon: CourtPoint[] | undefined,
  roi: TrackingRoi,
): CourtPoint[] | undefined {
  return polygon?.map((point) => ({
    x: (point.x - roi.x) / roi.width,
    y: (point.y - roi.y) / roi.height,
  }));
}

function AiVisionPage() {
  const match = useSharedBadmintonMatch();
  const { state: matchState, addPoint, undo, reset, setMode, teamName } = match;
  const score = { p1: matchState.score[0], p2: matchState.score[1] };
  const mode = matchState.mode;
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const captureRef = useRef<HTMLCanvasElement>(null);
  const localCaptureRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const cameraTrackRef = useRef<MediaStreamTrack | null>(null);
  const trackingRef = useRef(false);
  const lastScoreRef = useRef(0);
  const trailRef = useRef<TrailPoint[]>([]);
  const inFlightRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const localRafRef = useRef<number | null>(null);
  const localFrameCallbackRef = useRef<number | null>(null);
  const trackingRoiRef = useRef<TrackingRoi>({ x: 0, y: 0, width: 1, height: 1 });
  const skippedFramesRef = useRef(0);
  const processingMsRef = useRef(0);
  const localTrackRef = useRef<LocalTrack | null>(null);
  const previousGrayRef = useRef<Uint8ClampedArray | null>(null);
  const localFpsWindowRef = useRef({ frames: 0, startedAt: 0 });
  const localStatusRef = useRef(0);
  const liveConnectionRef = useRef<LiveTrackNetConnection | null>(null);
  const liveAwaitingRef = useRef(false);
  const liveReadyRef = useRef(false);
  const liveVisibleHistoryRef = useRef<Array<{ x: number; y: number; confidence: number }>>([]);
  const liveMissingFramesRef = useRef(0);

  const [streaming, setStreaming] = useState(false);
  const [tracking, setTracking] = useState(false);
  const [refereeMode, setRefereeMode] = useState<RefereeMode>("current");
  const [p1Side, setP1Side] = useState<"left" | "right">("left");
  const [result, setResult] = useState<TrackResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastPoint, setLastPoint] = useState<{ team: 1 | 2; at: number } | null>(null);
  const rallyRef = useRef(new LiveRally());
  const reviewRef = useRef(false);
  const [pointReview, setPointReview] = useState<string | null>(null);
  const [localFps, setLocalFps] = useState(0);
  const [localConfidence, setLocalConfidence] = useState(0);
  const [tracknetFps, setTracknetFps] = useState(0);
  const [tracknetBackend, setTracknetBackend] = useState("—");
  const [tracknetDevice, setTracknetDevice] = useState("—");
  const [tracknetDroppedFrames, setTracknetDroppedFrames] = useState(0);
  const [tracknetConnectionStatus, setTracknetConnectionStatus] =
    useState<TrackNetConnectionStatus>("idle");
  const [cameraFps, setCameraFps] = useState(0);
  const [cameraResolution, setCameraResolution] = useState({ width: 0, height: 0 });
  const [processingMs, setProcessingMs] = useState(0);
  const [cameraShift, setCameraShift] = useState({ x: 0, y: 0 });
  const [recoveryCount, setRecoveryCount] = useState(0);
  const [candidateCount, setCandidateCount] = useState(0);
  const [motionPixels, setMotionPixels] = useState(0);
  const [searchRadius, setSearchRadius] = useState(1);
  const [confidenceReason, setConfidenceReason] = useState("waiting for frames");
  const [fusionMode, setFusionMode] = useState<
    "local" | "agreeing" | "ai-recovery" | "disagreeing"
  >("local");
  const [cameraControls, setCameraControls] = useState<CameraControls>({ torch: false });
  const [cameraPreset, setCameraPreset] = useState<CameraPreset>("1080p60");
  const [torchEnabled, setTorchEnabled] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [exposure, setExposure] = useState(0);
  const [localMode, setLocalMode] = useState<"lost" | "acquiring" | "locked" | "coasting">("lost");
  const [courtCorners, setCourtCorners] = useState<CourtPoint[]>([]);
  const [calibrating, setCalibrating] = useState(false);
  const [lastHitter, setLastHitter] = useState<"p1" | "p2" | "unknown">("unknown");
  const [landingConfirmationCount, setLandingConfirmationCount] = useState(0);
  const pendingLandingRef = useRef<{
    team: 1 | 2;
    firstAt: number;
    lastAt: number;
    count: number;
    x: number;
    y: number;
  } | null>(null);
  const landingLockedRef = useRef(false);
  const landingReleaseFramesRef = useRef(0);
  const analysisSequenceRef = useRef(0);
  const lastHandledAnalysisRef = useRef(0);
  const lastResultRef = useRef<TrackResult | null>(null);

  const startCamera = useCallback(async () => {
    setError(null);
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          frameRate: { ideal: 60, max: 60 },
        },
        audio: false,
      });
      streamRef.current = s;
      const cameraTrack = s.getVideoTracks()[0] ?? null;
      cameraTrackRef.current = cameraTrack;
      const capabilities = (cameraTrack?.getCapabilities() ?? {}) as MediaTrackCapabilities & {
        torch?: boolean;
        zoom?: CameraRange;
        exposureCompensation?: CameraRange;
      };
      const settings = cameraTrack?.getSettings() as
        | (MediaTrackSettings & {
            torch?: boolean;
            zoom?: number;
            exposureCompensation?: number;
          })
        | undefined;
      setCameraControls({
        torch: capabilities.torch === true,
        zoom: capabilities.zoom,
        exposure: capabilities.exposureCompensation,
      });
      setTorchEnabled(settings?.torch === true);
      setZoom(settings?.zoom ?? capabilities.zoom?.min ?? 1);
      setExposure(settings?.exposureCompensation ?? 0);
      setCameraFps(settings?.frameRate ?? 0);
      setCameraResolution({ width: settings?.width ?? 0, height: settings?.height ?? 0 });
      setCameraPreset(
        settings?.height && settings.height >= 1000
          ? "1080p60"
          : settings?.height && settings.height >= 650
            ? settings.frameRate && settings.frameRate >= 50
              ? "720p60"
              : "720p30"
            : "480p30",
      );
      if (videoRef.current) videoRef.current.srcObject = s;
      setStreaming(true);
    } catch {
      setError("Could not access the camera. Grant permission and try again.");
    }
  }, []);

  const applyCameraConstraint = useCallback(async (constraint: Record<string, unknown>) => {
    const track = cameraTrackRef.current;
    if (!track) return false;
    try {
      await track.applyConstraints({ advanced: [constraint] } as MediaTrackConstraints);
      const settings = track.getSettings();
      setCameraFps(settings.frameRate ?? 0);
      setCameraResolution({ width: settings.width ?? 0, height: settings.height ?? 0 });
      return true;
    } catch (error) {
      setError(
        error instanceof Error
          ? `Camera setting failed: ${error.message}`
          : "Camera setting failed.",
      );
      return false;
    }
  }, []);

  const applyCameraPreset = useCallback(
    async (presetId: CameraPreset) => {
      const preset = CAMERA_PRESETS.find((item) => item.id === presetId);
      if (!preset) return;
      const applied = await applyCameraConstraint({
        width: { ideal: preset.width },
        height: { ideal: preset.height },
        frameRate: { ideal: preset.fps, max: preset.fps },
      });
      if (applied) setCameraPreset(presetId);
    },
    [applyCameraConstraint],
  );

  const stopCamera = useCallback(() => {
    trackingRef.current = false;
    liveConnectionRef.current?.close();
    liveConnectionRef.current = null;
    liveAwaitingRef.current = false;
    liveReadyRef.current = false;
    liveVisibleHistoryRef.current = [];
    liveMissingFramesRef.current = 0;
    localTrackRef.current = null;
    previousGrayRef.current = null;
    trailRef.current = [];
    trackingRoiRef.current = { x: 0, y: 0, width: 1, height: 1 };
    skippedFramesRef.current = 0;
    processingMsRef.current = 0;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    cameraTrackRef.current = null;
    streamRef.current = null;
    setStreaming(false);
    setTracking(false);
    setLocalFps(0);
    setLocalConfidence(0);
    setTracknetFps(0);
    setTracknetBackend("—");
    setTracknetDevice("—");
    setTracknetDroppedFrames(0);
    setTracknetConnectionStatus("idle");
    setCameraFps(0);
    setCameraResolution({ width: 0, height: 0 });
    setLocalMode("lost");
    setProcessingMs(0);
    setCameraShift({ x: 0, y: 0 });
    setRecoveryCount(0);
    setCandidateCount(0);
    setMotionPixels(0);
    setSearchRadius(1);
    setConfidenceReason("waiting for frames");
    setFusionMode("local");
    setCameraControls({ torch: false });
    setCameraPreset("1080p60");
    setTorchEnabled(false);
    setZoom(1);
    setExposure(0);
    pendingLandingRef.current = null;
    landingLockedRef.current = false;
    landingReleaseFramesRef.current = 0;
    setLandingConfirmationCount(0);
  }, []);

  useEffect(() => () => stopCamera(), [stopCamera]);

  useEffect(() => {
    if (!tracking) {
      pendingLandingRef.current = null;
      setLandingConfirmationCount(0);
    }
  }, [tracking]);

  const chooseRefereeMode = useCallback(
    (nextMode: RefereeMode) => {
      if (nextMode === refereeMode) return;
      trackingRef.current = false;
      liveConnectionRef.current?.close();
      liveConnectionRef.current = null;
      liveAwaitingRef.current = false;
      liveReadyRef.current = false;
      liveVisibleHistoryRef.current = [];
      liveMissingFramesRef.current = 0;
      localTrackRef.current = null;
      previousGrayRef.current = null;
      trailRef.current = [];
      pendingLandingRef.current = null;
      landingLockedRef.current = false;
      landingReleaseFramesRef.current = 0;
      setRefereeMode(nextMode);
      setTracking(false);
      setResult(null);
      setError(null);
      setLastPoint(null);
      setLandingConfirmationCount(0);
      setLocalFps(0);
      setLocalConfidence(0);
      setTracknetFps(0);
      setTracknetBackend("—");
      setTracknetDevice("—");
      setTracknetDroppedFrames(0);
      setTracknetConnectionStatus("idle");
      setFusionMode("local");
      setLocalMode("lost");
    },
    [refereeMode],
  );

  const captureFrame = useCallback((): string | null => {
    const video = videoRef.current;
    const canvas = captureRef.current;
    if (!video || !canvas || !video.videoWidth) return null;
    // Higher-resolution capture gives the model a much better shot at
    // localizing the small cork — bumped from 640/0.62 to 960/0.82.
    const maxW = 960;
    const scale = Math.min(1, maxW / video.videoWidth);
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.82);
  }, []);

  const analyzeFrame = useCallback(async () => {
    if (!requestVision.canSample()) return;
    const image = captureFrame();
    if (!image) return;
    const sequence = ++analysisSequenceRef.current;
    // Attach the current motion track as temporal context so the model
    // can sanity-check its localization against recent movement.
    const local = localTrackRef.current;
    const previousTrack =
      local && Date.now() - local.updatedAt < 500
        ? {
            x: local.x,
            y: local.y,
            vx: local.vx,
            vy: local.vy,
            ageMs: Date.now() - local.updatedAt,
          }
        : undefined;
    try {
      const res = await requestVision({
        image,
        mode,
        p1Side,
        courtCorners: courtCorners.length === 4 ? courtCorners : undefined,
        previousTrack,
        lastHitter,
      });
      const data = await res.json();
      // Concurrent requests can finish out of order. Older camera frames must
      // never overwrite newer results or count toward landing confirmation.
      if (sequence <= lastHandledAnalysisRef.current) return;
      lastHandledAnalysisRef.current = sequence;
      if (!trackingRef.current) return;
      if (!res.ok) {
        setError(data.error || "AI request failed");
        return;
      }
      setError(null);
      const aiData = data as TrackResult;

      // AI is a recovery sensor as well as a line judge. If it sees a strong
      // position that disagrees with a stale/coasting local track, hand the
      // lock back to AI and re-baseline the next motion frame.
      if (aiData.shuttleVisible) {
        const now = Date.now();
        const localNow = localTrackRef.current;
        const localAge = localNow ? now - localNow.lastSeen : Infinity;
        const aiLocalDistance = localNow
          ? Math.hypot(aiData.position.x - localNow.x, aiData.position.y - localNow.y)
          : Infinity;
        const shouldRecover =
          aiData.confidence >= 0.84 &&
          (!localNow ||
            localAge > 260 ||
            !localNow.visible ||
            localNow.confidence < LOCAL_TRACK_MIN_CONFIDENCE * 2 ||
            aiLocalDistance > 0.2);
        if (shouldRecover) {
          const dt = localNow ? Math.max(40, Math.min(400, localAge)) : 0;
          const recoveredVx = localNow ? (aiData.position.x - localNow.x) / dt : 0;
          const recoveredVy = localNow ? (aiData.position.y - localNow.y) / dt : 0;
          localTrackRef.current = {
            x: aiData.position.x,
            y: aiData.position.y,
            vx: recoveredVx,
            vy: recoveredVy,
            ax: localNow?.ax ?? 0,
            ay: localNow?.ay ?? 0,
            lastSeen: now,
            updatedAt: now,
            confidence: Math.max(0.4, aiData.confidence * 0.78),
            uncertainty: 0.12,
            visible: true,
            hits: Math.min(localNow?.hits ?? ACQUIRE_HITS, 4),
          };
          previousGrayRef.current = null;
          trailRef.current = trailRef.current.slice(-2);
          setRecoveryCount((count) => count + 1);
          setFusionMode("ai-recovery");
        }
      }

      // Fuse the model's slower but semantic estimate with the local
      // frame-by-frame estimate. When they agree, use the weighted midpoint;
      // when a locked local track disagrees with a weak AI guess, keep local.
      const fusedLocal = localTrackRef.current;
      let fusedData: TrackResult = aiData;
      if (aiData.shuttleVisible && fusedLocal?.visible) {
        const distance = Math.hypot(
          aiData.position.x - fusedLocal.x,
          aiData.position.y - fusedLocal.y,
        );
        const localTrust = Math.min(0.82, Math.max(0.2, fusedLocal.confidence));
        const aiTrust = Math.min(0.9, Math.max(0.2, aiData.confidence));
        if (distance <= 0.2) {
          const totalTrust = localTrust + aiTrust;
          const localWeight = localTrust / totalTrust;
          fusedData = {
            ...aiData,
            position: {
              x: aiData.position.x * (1 - localWeight) + fusedLocal.x * localWeight,
              y: aiData.position.y * (1 - localWeight) + fusedLocal.y * localWeight,
            },
            confidence: Math.min(
              0.99,
              aiData.confidence * 0.55 + fusedLocal.confidence * 0.45 + 0.08,
            ),
          };
          setFusionMode("agreeing");
        } else if (
          fusedLocal.hits >= 5 &&
          fusedLocal.confidence >= 0.5 &&
          aiData.confidence < 0.84
        ) {
          fusedData = { ...aiData, position: { x: fusedLocal.x, y: fusedLocal.y } };
          setFusionMode("local");
        } else {
          setFusionMode("disagreeing");
        }
      } else if (aiData.shuttleVisible) {
        setFusionMode("ai-recovery");
      }
      setResult(fusedData);
      lastResultRef.current = fusedData;

      // Confirm a landing across three consecutive AI frames that agree on
      // both the awarded team and the landing location.
      const now = Date.now();
      const strong =
        fusedData.landed &&
        fusedData.pointTo !== "none" &&
        fusedData.confidence >= 0.7 &&
        now - lastScoreRef.current > 3500;

      if (strong) {
        landingReleaseFramesRef.current = 0;
        if (landingLockedRef.current) {
          pendingLandingRef.current = null;
          setLandingConfirmationCount(0);
          return;
        }

        const team: 1 | 2 = fusedData.pointTo === "p1" ? 1 : 2;
        const pending = pendingLandingRef.current;
        const sameLanding =
          pending &&
          pending.team === team &&
          now - pending.lastAt <= LANDING_CONFIRMATION_WINDOW_MS &&
          Math.hypot(fusedData.position.x - pending.x, fusedData.position.y - pending.y) <=
            LANDING_POSITION_TOLERANCE;
        const next = sameLanding
          ? {
              ...pending,
              lastAt: now,
              count: pending.count + 1,
              x: (pending.x * pending.count + fusedData.position.x) / (pending.count + 1),
              y: (pending.y * pending.count + fusedData.position.y) / (pending.count + 1),
            }
          : {
              team,
              firstAt: now,
              lastAt: now,
              count: 1,
              x: fusedData.position.x,
              y: fusedData.position.y,
            };

        if (next.count >= LANDING_CONFIRMATION_FRAMES) {
          pendingLandingRef.current = null;
          landingLockedRef.current = true;
          setLandingConfirmationCount(0);
          lastScoreRef.current = now;
          addPoint(team === 1 ? 0 : 1, "gets the point after an AI line call");
          setLastPoint({ team, at: now });
        } else {
          pendingLandingRef.current = next;
          setLandingConfirmationCount(next.count);
        }
      } else {
        pendingLandingRef.current = null;
        setLandingConfirmationCount(0);

        // Keep a confirmed landing locked while the shuttle remains down so
        // one stationary shuttle cannot be scored a second time.
        if (landingLockedRef.current && !data.landed) {
          landingReleaseFramesRef.current += 1;
          if (landingReleaseFramesRef.current >= LANDING_RELEASE_FRAMES) {
            landingLockedRef.current = false;
            landingReleaseFramesRef.current = 0;
          }
        } else if (data.landed) {
          landingReleaseFramesRef.current = 0;
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    }
  }, [captureFrame, mode, p1Side, courtCorners, lastHitter, addPoint]);

  // The current referee's browser-side tracker runs at camera frame-rate so
  // the circle can keep up with badminton-speed motion.
  useEffect(() => {
    if (!tracking || !streaming || refereeMode !== "current") return;

    let cancelled = false;
    localFpsWindowRef.current = { frames: 0, startedAt: performance.now() };
    const flightZone = courtCorners.length === 4 ? expandFlightZone(courtCorners) : undefined;

    const step = () => {
      if (cancelled) return;
      if (skippedFramesRef.current > 0) {
        skippedFramesRef.current -= 1;
        return;
      }
      const startedAt = performance.now();
      try {
        const video = videoRef.current;
        const canvas = localCaptureRef.current;
        if (video && canvas && video.videoWidth > 0 && video.videoHeight > 0) {
          const height = Math.max(
            72,
            Math.round(LOCAL_TRACK_WIDTH * (video.videoHeight / video.videoWidth)),
          );
          if (canvas.width !== LOCAL_TRACK_WIDTH || canvas.height !== height) {
            canvas.width = LOCAL_TRACK_WIDTH;
            canvas.height = height;
            previousGrayRef.current = null;
          }

          const roi = chooseTrackingRoi(
            localTrackRef.current,
            video.videoHeight / video.videoWidth,
          );
          const previousRoi = trackingRoiRef.current;
          if (
            Math.abs(previousRoi.x - roi.x) > 0.025 ||
            Math.abs(previousRoi.y - roi.y) > 0.025 ||
            Math.abs(previousRoi.width - roi.width) > 0.025
          ) {
            previousGrayRef.current = null;
          }
          trackingRoiRef.current = roi;

          const ctx = canvas.getContext("2d", { willReadFrequently: true });
          if (ctx) {
            ctx.drawImage(
              video,
              roi.x * video.videoWidth,
              roi.y * video.videoHeight,
              roi.width * video.videoWidth,
              roi.height * video.videoHeight,
              0,
              0,
              canvas.width,
              canvas.height,
            );
            const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const now = Date.now();
            const priorForRoi = localTrackRef.current
              ? mapTrackToRoi(localTrackRef.current, roi)
              : null;
            const detection = detectBirdieMotion(
              frame.data,
              previousGrayRef.current,
              priorForRoi,
              canvas.width,
              canvas.height,
              now,
              mapPolygonToRoi(flightZone, roi),
            );
            previousGrayRef.current = detection.gray;
            const currentTrack = detection.track ? mapTrackFromRoi(detection.track, roi) : null;
            localTrackRef.current = currentTrack;

            if (
              currentTrack &&
              currentTrack.visible &&
              currentTrack.confidence > LOCAL_TRACK_MIN_CONFIDENCE
            ) {
              const last = trailRef.current[trailRef.current.length - 1];
              const jump = last ? Math.hypot(currentTrack.x - last.x, currentTrack.y - last.y) : 0;
              // Allow much larger jumps for fast rallies — only reset the trail
              // on truly discontinuous jumps that indicate a re-acquisition.
              // Keep the trail legible: do not add a new segment for sub-pixel
              // jitter, and cap it to a short recent path instead of a scribble.
              if (!last || jump > 0.012 || now - last.t > 180) {
                const smoothX = last ? last.x * 0.35 + currentTrack.x * 0.65 : currentTrack.x;
                const smoothY = last ? last.y * 0.35 + currentTrack.y * 0.65 : currentTrack.y;
                trailRef.current.push({ x: smoothX, y: smoothY, t: now });
              } else {
                // Hold the previous point while the shuttle is still.
                trailRef.current[trailRef.current.length - 1] = { ...last, t: now };
              }
              trailRef.current = trailRef.current.slice(-10).filter((p) => now - p.t < 1100);
            }

            const perfNow = performance.now();
            const fpsWindow = localFpsWindowRef.current;
            fpsWindow.frames++;
            if (perfNow - fpsWindow.startedAt > 500) {
              setLocalFps(Math.round((fpsWindow.frames * 1000) / (perfNow - fpsWindow.startedAt)));
              fpsWindow.frames = 0;
              fpsWindow.startedAt = perfNow;
            }

            if (now - localStatusRef.current > 180) {
              localStatusRef.current = now;
              setLocalConfidence(currentTrack?.confidence ?? 0);
              setCandidateCount(detection.candidates.length);
              setMotionPixels(detection.motionPixels);
              setSearchRadius(detection.searchRadius);
              setConfidenceReason(detection.confidenceReasons.slice(0, 2).join(" · "));
              setProcessingMs(Math.round(processingMsRef.current));
              setCameraShift({ x: detection.cameraShift.x, y: detection.cameraShift.y });
              setLocalMode(
                !currentTrack
                  ? "lost"
                  : now - currentTrack.lastSeen > 100
                    ? "coasting"
                    : currentTrack.hits >= 5 && (currentTrack.uncertainty ?? 0.18) < 0.28
                      ? "locked"
                      : "acquiring",
              );
            }
            const elapsed = performance.now() - startedAt;
            processingMsRef.current = processingMsRef.current * 0.8 + elapsed * 0.2;
            skippedFramesRef.current =
              processingMsRef.current > 34 ? 2 : processingMsRef.current > 22 ? 1 : 0;
          }
        }
      } catch (error) {
        cancelled = true;
        setError(
          error instanceof Error
            ? `Tracking stopped: ${error.message}`
            : "Tracking stopped unexpectedly.",
        );
        setTracking(false);
      }
    };

    const frameVideo = videoRef.current as
      | (HTMLVideoElement & {
          requestVideoFrameCallback?: (
            callback: (now: number, metadata: unknown) => void,
          ) => number;
          cancelVideoFrameCallback?: (handle: number) => void;
        })
      | null;
    if (!frameVideo) return;
    const scheduleNextFrame = () => {
      if (cancelled) return;
      if (typeof frameVideo.requestVideoFrameCallback === "function") {
        localFrameCallbackRef.current = frameVideo.requestVideoFrameCallback(() => {
          step();
          scheduleNextFrame();
        });
      } else {
        localRafRef.current = requestAnimationFrame(() => {
          step();
          scheduleNextFrame();
        });
      }
    };
    scheduleNextFrame();
    return () => {
      cancelled = true;
      if (localRafRef.current) cancelAnimationFrame(localRafRef.current);
      if (localFrameCallbackRef.current && frameVideo.cancelVideoFrameCallback) {
        frameVideo.cancelVideoFrameCallback(localFrameCallbackRef.current);
      }
    };
  }, [streaming, tracking, courtCorners, refereeMode]);

  // The existing AI referee uses the current line-judge flow. It remains
  // separate from TrackNet so the player can choose which engine to run.
  useEffect(() => {
    if (!tracking || !streaming || refereeMode !== "current") return;
    trackingRef.current = true;
    // One in-flight request keeps AI corrections in chronological order and
    // avoids spending bandwidth on frames that are already stale.
    const MAX_CONCURRENT = 1;

    const pump = async () => {
      while (trackingRef.current) {
        if (inFlightRef.current < MAX_CONCURRENT) {
          inFlightRef.current++;
          void analyzeFrame().finally(() => {
            inFlightRef.current--;
          });
        }
        const local = localTrackRef.current;
        const delay = !local || !local.visible ? 140 : local.uncertainty > 0.24 ? 180 : 260;
        await new Promise((r) => setTimeout(r, delay));
      }
    };
    void pump();

    return () => {
      trackingRef.current = false;
    };
  }, [tracking, streaming, refereeMode, analyzeFrame]);

  // TrackNet/OpenVINO live inference. Only one frame may be in flight; this
  // prevents a slow machine from building an ever-growing socket queue.
  useEffect(() => {
    if (!tracking || !streaming || refereeMode !== "tracknet") return;
    let cancelled = false;
    const controller = new AbortController();
    let connection: LiveTrackNetConnection | null = null;
    let framePump: ReturnType<typeof startLiveFramePump> | undefined;
    const startedAt = performance.now();
    let responses = 0;
    liveReadyRef.current = false;
    liveAwaitingRef.current = false;
    liveVisibleHistoryRef.current = [];
    setLocalConfidence(0);
    setTracknetFps(0);
    setResult(null);
    rallyRef.current = new LiveRally();
    reviewRef.current = false;
    setPointReview(null);
    setTracknetConnectionStatus("connecting");

    const handleMessage = (message: LiveTrackNetDetection) => {
      if (cancelled) return;
      if (message.type === "ready") {
        setTracknetBackend(message.backend ?? "—");
        setTracknetDevice(message.device ?? "—");
        liveReadyRef.current = true;
        setTracknetConnectionStatus("ready");
        setConfidenceReason("TrackNet connected; waiting for shuttle frames.");
        setError(null);
        return;
      }
      liveAwaitingRef.current = false;
      if (message.type === "error") {
        setTracknetConnectionStatus("error");
        setError(`TrackNet live error: ${message.error ?? "unknown error"}`);
        return;
      }
      responses++;
      queueMicrotask(() => {
        if (!cancelled) framePump?.ready();
      });
      const clue = rallyRef.current.update(
        message.visible ? (message.x ?? null) : null,
        message.visible ? (message.y ?? null) : null,
        message.confidence ?? 0,
        message.timestamp ?? Date.now(),
      );
      if (clue && !reviewRef.current) {
        reviewRef.current = true;
        setPointReview(clue);
      }
      setTracknetFps(Math.round((responses * 1000) / Math.max(1, performance.now() - startedAt)));
      if (message.processing_ms !== undefined) setProcessingMs(Math.round(message.processing_ms));
      if (message.visible && message.x != null && message.y != null) {
        const point = { x: message.x, y: message.y, confidence: message.confidence ?? 0 };
        liveMissingFramesRef.current = 0;
        liveVisibleHistoryRef.current = [...liveVisibleHistoryRef.current, point].slice(-8);
        const liveResult: TrackResult = {
          shuttleVisible: true,
          position: { x: point.x, y: point.y },
          landed: false,
          call: "unknown",
          pointTo: "none",
          confidence: point.confidence,
          reasoning: `Local TrackNet detection on ${message.device ?? "the active device"}.`,
        };
        setResult(liveResult);
        setLocalConfidence(point.confidence);
        setLocalMode("locked");
        setConfidenceReason(
          `TrackNet detected the shuttle at ${Math.round(point.confidence * 100)}% confidence.`,
        );
        return;
      }

      liveMissingFramesRef.current++;
      const history = liveVisibleHistoryRef.current;
      const last = history[history.length - 1];
      setLocalMode("lost");
      setLocalConfidence(0);
      setConfidenceReason("TrackNet is scanning the camera for the shuttle.");
      setResult({
        shuttleVisible: false,
        position: last ? { x: last.x, y: last.y } : { x: 0.5, y: 0.5 },
        landed: false,
        call: "unknown",
        pointTo: "none",
        confidence: 0,
        reasoning: "Shuttle not visible; no point counted. Confirm the winner if the rally ended.",
      });
      if (liveMissingFramesRef.current >= 5) liveVisibleHistoryRef.current = [];
    };

    const start = async () => {
      try {
        connection = await connectLiveTrackNet(
          handleMessage,
          (event) => {
            if (!cancelled) {
              liveReadyRef.current = false;
              setLocalConfidence(0);
              setTracknetFps(0);
              setResult(null);
              setTracking(false);
              setTracknetConnectionStatus("error");
              setConfidenceReason(
                event.type.includes("timeout")
                  ? "TrackNet timed out waiting for a response."
                  : "TrackNet connection lost.",
              );
              setError("TrackNet live connection lost. Restart tracking to reconnect.");
            }
          },
          () => {
            if (!cancelled) {
              liveReadyRef.current = false;
              setTracknetConnectionStatus("error");
              setLocalConfidence(0);
              setTracknetFps(0);
              setResult(null);
              setTracking(false);
              setConfidenceReason("TrackNet connection closed.");
              setError("TrackNet live connection closed before it could finish tracking.");
            }
          },
          { signal: controller.signal },
        );
        if (cancelled) {
          connection.close();
          return;
        }
        liveConnectionRef.current = connection;
        if (!videoRef.current) throw new Error("Camera is unavailable");
        framePump = startLiveFramePump(videoRef.current, connection, (count) =>
          setTracknetDroppedFrames((total) => total + count),
        );
        return () => framePump?.stop();
      } catch (error) {
        if (!cancelled) {
          setTracknetConnectionStatus("error");
          setConfidenceReason("TrackNet could not connect.");
          setError(error instanceof Error ? error.message : "TrackNet live connection failed.");
        }
      }
    };
    let cleanupTimer: (() => void) | undefined;
    void start().then((cleanup) => {
      cleanupTimer = cleanup;
    });
    return () => {
      cancelled = true;
      controller.abort();
      framePump?.stop();
      liveReadyRef.current = false;
      cleanupTimer?.();
      liveAwaitingRef.current = false;
      connection?.close();
      if (liveConnectionRef.current === connection) liveConnectionRef.current = null;
    };
  }, [tracking, streaming, refereeMode, captureFrame, courtCorners, p1Side, addPoint]);

  // Overlay render loop (animation frame) — draws trail + current position smoothly
  useEffect(() => {
    const draw = () => {
      const canvas = overlayRef.current;
      const video = videoRef.current;
      if (canvas && video) {
        const rect = video.getBoundingClientRect();
        if (canvas.width !== rect.width || canvas.height !== rect.height) {
          canvas.width = rect.width;
          canvas.height = rect.height;
        }
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.clearRect(0, 0, canvas.width, canvas.height);

          // Trail — continuous smoothed curve using midpoint-quadratic technique.
          // Each segment goes from midpoint(i-1,i) → midpoint(i,i+1) with point i as
          // the control, which chains naturally into a flowing curve (no zig-zags).
          const trail = trailRef.current;
          const now = Date.now();
          if (trail.length > 1) {
            ctx.lineWidth = 3;
            ctx.lineCap = "round";
            ctx.lineJoin = "round";
            const W = canvas.width;
            const H = canvas.height;
            const px = (p: TrailPoint) => p.x * W;
            const py = (p: TrailPoint) => p.y * H;

            for (let i = 0; i < trail.length - 1; i++) {
              const p0 = trail[i === 0 ? 0 : i - 1];
              const p1 = trail[i];
              const p2 = trail[i + 1];
              const p3 = trail[i + 2] ?? p2;

              const age = (now - p2.t) / 1500;
              const alpha = Math.max(0, 1 - age);
              if (alpha <= 0.02) continue;

              const startX = i === 0 ? px(p1) : (px(p0) + px(p1)) / 2;
              const startY = i === 0 ? py(p1) : (py(p0) + py(p1)) / 2;
              const endX = i + 2 >= trail.length ? px(p2) : (px(p1) + px(p2)) / 2;
              const endY = i + 2 >= trail.length ? py(p2) : (py(p1) + py(p2)) / 2;

              ctx.strokeStyle = `rgba(56, 189, 248, ${alpha.toFixed(2)})`;
              ctx.beginPath();
              ctx.moveTo(startX, startY);
              ctx.quadraticCurveTo(px(p1), py(p1), endX, endY);
              ctx.stroke();

              // second half of the segment, curving toward the next control point
              const midX = (px(p1) + px(p2)) / 2;
              const midY = (py(p1) + py(p2)) / 2;
              const nextEndX = i + 3 >= trail.length ? px(p2) : (px(p2) + px(p3)) / 2;
              const nextEndY = i + 3 >= trail.length ? py(p2) : (py(p2) + py(p3)) / 2;
              ctx.beginPath();
              ctx.moveTo(midX, midY);
              ctx.quadraticCurveTo(px(p2), py(p2), nextEndX, nextEndY);
              ctx.stroke();
            }
          }

          // Draw calibrated court polygon so the user can see what boundary
          // the server is judging in/out against.
          if (courtCorners.length > 0) {
            ctx.save();
            ctx.strokeStyle = "rgba(250, 204, 21, 0.9)";
            ctx.lineWidth = 2;
            ctx.setLineDash([6, 4]);
            ctx.beginPath();
            courtCorners.forEach((c, i) => {
              const x = c.x * canvas.width;
              const y = c.y * canvas.height;
              if (i === 0) ctx.moveTo(x, y);
              else ctx.lineTo(x, y);
            });
            if (courtCorners.length === 4) ctx.closePath();
            ctx.stroke();
            ctx.setLineDash([]);
            // Corner handles + numbers
            courtCorners.forEach((c, i) => {
              const x = c.x * canvas.width;
              const y = c.y * canvas.height;
              ctx.fillStyle = "rgba(250, 204, 21, 0.95)";
              ctx.beginPath();
              ctx.arc(x, y, 5, 0, Math.PI * 2);
              ctx.fill();
              ctx.fillStyle = "#000";
              ctx.font = "bold 11px system-ui";
              ctx.fillText(String(i + 1), x - 3, y - 8);
            });
            ctx.restore();
          }

          // Current cork position comes from the browser motion tracker first,
          // with AI coordinates as a slower fallback for re-acquisition.
          const localTrack = localTrackRef.current;
          const aiResult = result;
          const hasLocalTrack = Boolean(
            localTrack &&
            localTrack.confidence > LOCAL_TRACK_MIN_CONFIDENCE * 0.6 &&
            now - localTrack.updatedAt < LOCAL_TRACK_COAST_MS,
          );
          const hasAiTrack = Boolean(aiResult?.shuttleVisible && aiResult.confidence >= 0.35);
          if (hasLocalTrack || hasAiTrack) {
            const useTrackNet = hasAiTrack;
            const px = useTrackNet ? aiResult!.position.x : localTrack!.x;
            const py = useTrackNet ? aiResult!.position.y : localTrack!.y;
            const cx = px * canvas.width;
            const cy = py * canvas.height;
            const radius = Math.max(9, Math.min(canvas.width, canvas.height) * 0.024);
            const color = aiResult?.landed
              ? aiResult.call === "in"
                ? "#22c55e"
                : aiResult.call === "out"
                  ? "#ef4444"
                  : "#eab308"
              : "#38bdf8";
            // Ring on the cork
            ctx.strokeStyle = color;
            ctx.lineWidth = 2.5;
            ctx.beginPath();
            ctx.arc(cx, cy, radius, 0, Math.PI * 2);
            ctx.stroke();
            // Crosshair through cork
            ctx.beginPath();
            ctx.moveTo(cx - radius - 6, cy);
            ctx.lineTo(cx - radius + 2, cy);
            ctx.moveTo(cx + radius - 2, cy);
            ctx.lineTo(cx + radius + 6, cy);
            ctx.moveTo(cx, cy - radius - 6);
            ctx.lineTo(cx, cy - radius + 2);
            ctx.moveTo(cx, cy + radius - 2);
            ctx.lineTo(cx, cy + radius + 6);
            ctx.stroke();
            // Center dot
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(cx, cy, 2.5, 0, Math.PI * 2);
            ctx.fill();
            // Label
            ctx.font = "bold 12px system-ui";
            ctx.fillText(
              aiResult?.landed ? aiResult.call.toUpperCase() : "CORK",
              cx + radius + 8,
              cy + 4,
            );
          }
        }
      }
      rafRef.current = requestAnimationFrame(draw);
    };
    rafRef.current = requestAnimationFrame(draw);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [result, courtCorners]);

  const onOverlayClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!calibrating) return;
      const canvas = e.currentTarget;
      const rect = canvas.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width;
      const y = (e.clientY - rect.top) / rect.height;
      setCourtCorners((prev) => {
        if (prev.length >= 4) return prev;
        const next = [...prev, { x, y }];
        if (next.length === 4) setCalibrating(false);
        return next;
      });
    },
    [calibrating],
  );

  const undoLast = () => {
    if (!lastPoint) return;
    undo();
    setLastPoint(null);
  };

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div>
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Badminton Game Tracker
        </p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">AI Referee</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Choose how you want the referee to follow the shuttle and score the match.
        </p>
      </div>

      <section
        className="rounded-2xl border border-border bg-card p-4"
        aria-labelledby="referee-mode-title"
      >
        <div className="mb-3">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Referee engine
          </p>
          <h2 id="referee-mode-title" className="mt-1 text-base font-semibold text-foreground">
            Choose your AI referee
          </h2>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => chooseRefereeMode("current")}
            className={`rounded-xl border p-4 text-left transition-colors ${refereeMode === "current" ? "border-primary bg-primary/10" : "border-border bg-background hover:border-primary/50"}`}
            aria-pressed={refereeMode === "current"}
          >
            <div className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-2 font-semibold text-foreground">
                <Camera className="h-4 w-4 text-primary" /> Live referee
              </span>
              <span className="text-[10px] font-semibold uppercase tracking-wider text-primary">
                Current
              </span>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              Uses the existing browser motion tracker and AI line judge for live scoring.
            </p>
          </button>
          <button
            type="button"
            onClick={() => chooseRefereeMode("tracknet")}
            className={`rounded-xl border p-4 text-left transition-colors ${refereeMode === "tracknet" ? "border-primary bg-primary/10" : "border-border bg-background hover:border-primary/50"}`}
            aria-pressed={refereeMode === "tracknet"}
          >
            <div className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-2 font-semibold text-foreground">
                <Crosshair className="h-4 w-4 text-primary" /> TrackNet AI
              </span>
              <span className="text-[10px] font-semibold uppercase tracking-wider text-primary">
                OpenVINO
              </span>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              Uses the local TrackNet model for dedicated shuttle detection and landing calls.
            </p>
          </button>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          {refereeMode === "tracknet"
            ? "TrackNet must be running with npm run shuttleboard before you start tracking."
            : "This is the current referee experience. Choose TrackNet when you want the dedicated model."}
        </p>
      </section>

      {/* Scoreboard */}
      {refereeMode === "tracknet" && pointReview && (
        <div className="rounded-xl border border-border bg-card p-4" role="status">
          <p>{pointReview}</p>
          <p className="text-sm text-muted-foreground">
            No point added yet. Pick the winner only if the rally ended.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {([0, 1] as const).map((team) => (
              <button
                key={team}
                className="rounded-lg bg-primary px-3 py-2 text-primary-foreground"
                onClick={() => {
                  if (!reviewRef.current) return;
                  reviewRef.current = false;
                  rallyRef.current.resolve();
                  setPointReview(null);
                  addPoint(team, "wins a user-confirmed rally");
                  setLastPoint({ team: team === 0 ? 1 : 2, at: Date.now() });
                }}
              >
                {teamName(team)} wins
              </button>
            ))}
            <button
              className="rounded-lg border px-3 py-2"
              onClick={() => {
                reviewRef.current = false;
                rallyRef.current.resolve();
                setPointReview(null);
              }}
            >
              Still playing / dismiss
            </button>
          </div>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <ScoreCard
          label={`${teamName(0)} (${p1Side === "left" ? "LEFT" : "RIGHT"})`}
          score={score.p1}
          highlight={lastPoint?.team === 1}
        />
        <ScoreCard
          label={`${teamName(1)} (${p1Side === "left" ? "RIGHT" : "LEFT"})`}
          score={score.p2}
          highlight={lastPoint?.team === 2}
        />
      </div>

      <AiStatusStrip
        streaming={streaming}
        tracking={tracking}
        refereeMode={refereeMode}
        tracknetConnectionStatus={tracknetConnectionStatus}
        calibrating={calibrating}
        localMode={localMode}
        fusionMode={fusionMode}
        confidence={Math.round(
          Math.min(
            0.99,
            Math.max(result?.confidence ?? 0, localConfidence, result?.confidence ?? 0),
          ) * 100,
        )}
        reason={confidenceReason}
      />

      {/* Settings */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex rounded-lg border border-border p-1">
          <ToggleButton selected={mode === "singles"} onClick={() => setMode("singles")}>
            Singles
          </ToggleButton>
          <ToggleButton selected={mode === "doubles"} onClick={() => setMode("doubles")}>
            Doubles
          </ToggleButton>
        </div>
        <div
          className="inline-flex items-center gap-1 rounded-lg border border-border p-1"
          aria-label="Last hitter"
        >
          <span className="px-2 text-xs text-muted-foreground">Last hit</span>
          <ToggleButton selected={lastHitter === "p1"} onClick={() => setLastHitter("p1")}>
            {teamName(0)}
          </ToggleButton>
          <ToggleButton selected={lastHitter === "p2"} onClick={() => setLastHitter("p2")}>
            {teamName(1)}
          </ToggleButton>
        </div>
        <div className="inline-flex rounded-lg border border-border p-1">
          <ToggleButton selected={p1Side === "left"} onClick={() => setP1Side("left")}>
            P1 Left
          </ToggleButton>
          <ToggleButton selected={p1Side === "right"} onClick={() => setP1Side("right")}>
            P1 Right
          </ToggleButton>
        </div>
        <div className="flex gap-2">
          <button
            onClick={undoLast}
            disabled={!lastPoint}
            className="inline-flex items-center gap-1.5 rounded-lg border border-input bg-background px-3 py-1.5 text-sm font-medium hover:bg-accent disabled:opacity-50"
          >
            <RotateCcw className="h-4 w-4" /> Undo
          </button>
          <button
            onClick={() => {
              reset();
              setLastPoint(null);
            }}
            className="rounded-lg border border-input bg-background px-3 py-1.5 text-sm font-medium hover:bg-accent"
          >
            Reset
          </button>
        </div>
      </div>

      {/* Camera view */}
      <div className="overflow-hidden rounded-2xl border border-border bg-black">
        <div className="relative aspect-video w-full">
          <video ref={videoRef} autoPlay playsInline muted className="h-full w-full object-cover" />
          <canvas
            ref={overlayRef}
            onClick={onOverlayClick}
            className={`absolute inset-0 h-full w-full ${calibrating ? "cursor-crosshair" : "pointer-events-none"}`}
          />

          <canvas ref={captureRef} className="hidden" />
          <canvas ref={localCaptureRef} className="hidden" />
          {!streaming && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-muted text-muted-foreground">
              <Camera className="h-10 w-10" />
              <p className="text-sm">Camera off</p>
            </div>
          )}
          {tracking && (
            <div className="absolute left-3 top-3 rounded-lg bg-black/70 px-3 py-1.5 text-xs font-medium text-white">
              <div className="flex items-center gap-2">
                <span
                  className={`h-2 w-2 rounded-full ${localMode === "locked" ? "bg-primary shadow-[0_0_8px_var(--primary)]" : "animate-pulse bg-yellow-400"}`}
                />
                {localMode === "locked"
                  ? "Tracking locked"
                  : localMode === "coasting"
                    ? "Tracking briefly lost"
                    : "Searching for shuttle"}
                <span className="ml-1 text-white/70">
                  {Math.round(Math.max(localConfidence, result?.confidence ?? 0) * 100)}%
                </span>
              </div>
              <div className="mt-0.5 max-w-[min(90vw,420px)] text-[10px] text-white/65">
                {confidenceReason}
              </div>
            </div>
          )}
          {tracking && localConfidence <= LOCAL_TRACK_MIN_CONFIDENCE && (
            <div className="absolute bottom-3 left-3 rounded-full bg-black/60 px-3 py-1 text-xs font-medium text-white">
              shuttle lost — scanning full court
            </div>
          )}
          {calibrating && (
            <div className="pointer-events-none absolute inset-x-3 top-3 flex items-center justify-between gap-2 rounded-lg bg-yellow-500/90 px-3 py-2 text-xs font-semibold text-black">
              <span className="flex items-center gap-2">
                <Crosshair className="h-4 w-4" />
                Tap {CORNER_LABELS[courtCorners.length] ?? "done"} ({courtCorners.length}/4)
              </span>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-border bg-card p-3">
          {!streaming ? (
            <button
              onClick={startCamera}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
            >
              <Camera className="h-4 w-4" /> Start Camera
            </button>
          ) : (
            <>
              {!tracking ? (
                <button
                  onClick={() => {
                    requestVision.resume();
                    setTracking(true);
                  }}
                  className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
                >
                  <Play className="h-4 w-4" /> Start Tracking
                </button>
              ) : (
                <button
                  onClick={() => setTracking(false)}
                  className="inline-flex items-center gap-2 rounded-lg border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-accent"
                >
                  <Square className="h-4 w-4" /> Pause
                </button>
              )}
              <button
                onClick={() => {
                  if (calibrating) {
                    setCalibrating(false);
                  } else {
                    setCourtCorners([]);
                    setCalibrating(true);
                  }
                }}
                disabled={!streaming}
                className="inline-flex items-center gap-1.5 rounded-lg border border-input bg-background px-3 py-2 text-sm font-medium hover:bg-accent disabled:opacity-50"
              >
                {courtCorners.length === 4 && !calibrating ? (
                  <>
                    <Check className="h-4 w-4 text-green-500" /> Court set
                  </>
                ) : (
                  <>
                    <Crosshair className="h-4 w-4" /> {calibrating ? "Cancel" : "Calibrate court"}
                  </>
                )}
              </button>
              <label className="flex items-center gap-2 rounded-lg border border-input bg-background px-3 py-1.5 text-xs">
                Quality
                <select
                  value={cameraPreset}
                  onChange={(event) => void applyCameraPreset(event.target.value as CameraPreset)}
                  className="bg-transparent text-xs outline-none"
                >
                  {CAMERA_PRESETS.map((preset) => (
                    <option key={preset.id} value={preset.id}>
                      {preset.label}
                    </option>
                  ))}
                </select>
              </label>
              {cameraControls.torch && (
                <button
                  onClick={async () => {
                    const next = !torchEnabled;
                    if (await applyCameraConstraint({ torch: next })) setTorchEnabled(next);
                  }}
                  className="rounded-lg border border-input bg-background px-3 py-2 text-sm font-medium hover:bg-accent"
                >
                  {torchEnabled ? "Torch on" : "Torch off"}
                </button>
              )}
              {cameraControls.zoom && (
                <label className="flex items-center gap-2 rounded-lg border border-input bg-background px-3 py-1.5 text-xs">
                  Zoom
                  <input
                    type="range"
                    min={cameraControls.zoom.min}
                    max={cameraControls.zoom.max}
                    step={cameraControls.zoom.step ?? 0.1}
                    value={zoom}
                    onChange={(event) => {
                      const value = Number(event.target.value);
                      setZoom(value);
                      void applyCameraConstraint({ zoom: value });
                    }}
                    className="w-20"
                  />
                </label>
              )}
              {cameraControls.exposure && (
                <label className="flex items-center gap-2 rounded-lg border border-input bg-background px-3 py-1.5 text-xs">
                  Exposure
                  <input
                    type="range"
                    min={cameraControls.exposure.min}
                    max={cameraControls.exposure.max}
                    step={cameraControls.exposure.step ?? 0.1}
                    value={exposure}
                    onChange={(event) => {
                      const value = Number(event.target.value);
                      setExposure(value);
                      void applyCameraConstraint({ exposureCompensation: value });
                    }}
                    className="w-20"
                  />
                </label>
              )}
              <button
                onClick={stopCamera}
                className="ml-auto inline-flex items-center gap-2 rounded-lg border border-input bg-background px-3 py-2 text-sm font-medium hover:bg-accent"
              >
                Stop Camera
              </button>
            </>
          )}
        </div>
      </div>

      {streaming && (
        <details className="rounded-xl border border-border bg-card px-4 py-3 text-xs">
          <summary className="cursor-pointer font-semibold text-foreground">
            Technical diagnostics
          </summary>
          <div className="mt-3 grid gap-2 text-muted-foreground sm:grid-cols-2 lg:grid-cols-4">
            <span>
              Camera:{" "}
              {cameraResolution.width
                ? `${cameraResolution.width}×${cameraResolution.height}`
                : "—"}{" "}
              @ {cameraFps ? Math.round(cameraFps) : "—"} fps
            </span>
            <span>
              Local tracker: {localFps} fps · {localMode}
            </span>
            <span>
              TrackNet: {tracknetFps} fps · {processingMs}ms
            </span>
            <span>
              Backend: {tracknetBackend} · {tracknetDevice}
            </span>
            <span>Dropped frames: {tracknetDroppedFrames}</span>
            <span>
              Fusion: {fusionMode} · recoveries {recoveryCount}
            </span>
            <span>
              Candidates: {candidateCount} · motion pixels {motionPixels}
            </span>
            <span>Search radius: {Math.round(searchRadius * 100)}%</span>
            <span>Camera shift: {Math.round(Math.hypot(cameraShift.x, cameraShift.y))}px</span>
            <span>Confidence: {confidenceReason}</span>
          </div>
        </details>
      )}

      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {result && (
        <div className="rounded-xl border border-border bg-card p-4 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-semibold">
              {landingConfirmationCount > 0
                ? `Confirming landing ${landingConfirmationCount}/${LANDING_CONFIRMATION_FRAMES}`
                : result.shuttleVisible
                  ? result.landed
                    ? `Landed · ${result.call.toUpperCase()}`
                    : "In flight"
                  : "Shuttle not visible"}
            </span>
            <span className="text-xs text-muted-foreground">
              Confidence{" "}
              {Math.round(
                Math.min(0.99, Math.max(result.confidence, localConfidence, result.confidence)) *
                  100,
              )}
              %
            </span>
          </div>
          <p className="mt-2 text-muted-foreground">{result.reasoning}</p>
        </div>
      )}

      <div className="rounded-2xl border border-border bg-card p-4 text-sm">
        <div className="mb-2 flex items-center gap-2">
          <Lightbulb className="h-4 w-4 text-primary" />
          <h3 className="font-semibold">Keep tracking confidence above 90%</h3>
        </div>
        <p className="mb-3 text-muted-foreground">
          The circle tracks motion from the live camera at frame rate; AI requires three matching
          frames before it confirms a landing and scores. Set which side Player 1 defends so points
          go to the right player. Use Undo to fix any bad call.
        </p>
        <ul className="space-y-1.5 text-muted-foreground">
          <li className="flex gap-2">
            <span className="text-primary">•</span>
            <span>
              Mount the phone on a tripod or shelf — shaky footage is the #1 confidence killer.
            </span>
          </li>
          <li className="flex gap-2">
            <span className="text-primary">•</span>
            <span>
              Place the camera at net-post height, looking at the full court from the side.
            </span>
          </li>
          <li className="flex gap-2">
            <span className="text-primary">•</span>
            <span>Use even, bright lighting — avoid backlight, glare, and harsh shadows.</span>
          </li>
          <li className="flex gap-2">
            <span className="text-primary">•</span>
            <span>Frame the court tightly; remove busy backgrounds, spectators, and clutter.</span>
          </li>
          <li className="flex gap-2">
            <span className="text-primary">•</span>
            <span>Use a plain, contrasting floor — bright shuttlecocks stand out best.</span>
          </li>
          <li className="flex gap-2">
            <span className="text-primary">•</span>
            <span>Keep the lens clean and record in 1080p or higher.</span>
          </li>
        </ul>
      </div>
    </div>
  );
}

function AiStatusStrip({
  streaming,
  tracking,
  refereeMode,
  tracknetConnectionStatus,
  calibrating,
  localMode,
  fusionMode,
  confidence,
  reason,
}: {
  streaming: boolean;
  tracking: boolean;
  refereeMode: RefereeMode;
  tracknetConnectionStatus: TrackNetConnectionStatus;
  calibrating: boolean;
  localMode: "lost" | "acquiring" | "locked" | "coasting";
  fusionMode: "local" | "agreeing" | "ai-recovery" | "disagreeing";
  confidence: number;
  reason: string;
}) {
  const status = !streaming
    ? {
        label: "Camera ready",
        detail: "Start the camera when the phone is mounted.",
        tone: "muted",
      }
    : calibrating
      ? {
          label: "Calibrate the court",
          detail: "Tap all four corners so AI can judge landings accurately.",
          tone: "warn",
        }
      : !tracking
        ? {
            label: refereeMode === "tracknet" ? "TrackNet ready" : "Tracking paused",
            detail:
              refereeMode === "tracknet"
                ? "Start tracking to connect to the local TrackNet model."
                : "Start tracking when the full court is visible.",
            tone: "muted",
          }
        : refereeMode === "tracknet" && tracknetConnectionStatus === "connecting"
          ? {
              label: "Connecting to TrackNet",
              detail: "Waiting for the local model to accept camera frames.",
              tone: "warn",
            }
          : refereeMode === "tracknet" && tracknetConnectionStatus === "error"
            ? {
                label: "TrackNet unavailable",
                detail: "Check npm run shuttleboard, then pause and restart tracking.",
                tone: "warn",
              }
            : refereeMode === "tracknet" && localMode === "locked"
              ? {
                  label: "TrackNet locked",
                  detail: reason,
                  tone: "good",
                }
              : localMode === "locked"
                ? {
                    label: fusionMode === "agreeing" ? "AI and camera agree" : "Shuttle locked",
                    detail: reason,
                    tone: "good",
                  }
                : {
                    label: "Searching for shuttle",
                    detail: reason || "Keep the camera steady and the full court in frame.",
                    tone: "warn",
                  };
  const toneClass =
    status.tone === "good"
      ? "border-primary/30 bg-primary/10"
      : status.tone === "warn"
        ? "border-yellow-500/30 bg-yellow-500/10"
        : "border-border bg-card";
  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3 ${toneClass}`}
    >
      <div className="flex min-w-0 items-center gap-2">
        <span
          className={`h-2.5 w-2.5 shrink-0 rounded-full ${status.tone === "good" ? "bg-primary" : status.tone === "warn" ? "bg-yellow-400" : "bg-muted-foreground"}`}
        />
        <div className="min-w-0">
          <p className="text-sm font-semibold">{status.label}</p>
          <p className="truncate text-xs text-muted-foreground">{status.detail}</p>
        </div>
      </div>
      {tracking && (
        <div className="rounded-full border border-white/10 bg-background/40 px-2.5 py-1 text-[10px] font-semibold text-muted-foreground">
          Confidence {confidence}%
        </div>
      )}
    </div>
  );
}

function ScoreCard({
  label,
  score,
  highlight,
}: {
  label: string;
  score: number;
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl border p-4 transition-colors ${
        highlight ? "border-primary bg-primary/5" : "border-border bg-card"
      }`}
    >
      <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
      <span className="mt-1 block text-4xl font-bold tabular-nums">{score}</span>
    </div>
  );
}

function ToggleButton({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
        selected
          ? "bg-primary text-primary-foreground"
          : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}
