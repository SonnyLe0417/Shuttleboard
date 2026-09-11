import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { TrackNetResult } from "@/lib/tracknet-client";

const STORAGE_KEY = "shuttleboard.tracknet-analysis";

export type TrackNetAnalysisPhase =
  "idle" | "uploading" | "queued" | "processing" | "completed" | "failed";

export interface TrackNetAnalysisJob {
  jobId: string;
  fileName: string;
  startedAt: number;
}

interface TrackNetAnalysisContextValue {
  job: TrackNetAnalysisJob | null;
  phase: TrackNetAnalysisPhase;
  progress: number;
  etaSeconds: number | null;
  result: TrackNetResult | null;
  error: string | null;
  start: (file: File) => Promise<void>;
  clear: () => void;
}

const TrackNetAnalysisContext = createContext<TrackNetAnalysisContextValue | null>(null);

function readStoredJob(): TrackNetAnalysisJob | null {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    if (!value) return null;
    const parsed = JSON.parse(value) as Partial<TrackNetAnalysisJob>;
    if (
      typeof parsed.jobId !== "string" ||
      typeof parsed.fileName !== "string" ||
      typeof parsed.startedAt !== "number"
    ) {
      return null;
    }
    return { jobId: parsed.jobId, fileName: parsed.fileName, startedAt: parsed.startedAt };
  } catch {
    return null;
  }
}

function storeJob(job: TrackNetAnalysisJob | null) {
  try {
    if (job) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(job));
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Local storage can be unavailable in private browsing; the in-memory job still works.
  }
}

export function TrackNetAnalysisProvider({ children }: { children: ReactNode }) {
  const [job, setJob] = useState<TrackNetAnalysisJob | null>(null);
  const [phase, setPhase] = useState<TrackNetAnalysisPhase>("idle");
  const [progress, setProgress] = useState(0);
  const [etaSeconds, setEtaSeconds] = useState<number | null>(null);
  const [result, setResult] = useState<TrackNetResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const runTokenRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const pollJob = useCallback(
    (nextJob: TrackNetAnalysisJob, options?: { clearMissingJob?: boolean }) => {
      const token = ++runTokenRef.current;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setPhase("processing");
      setError(null);

      void (async () => {
        try {
          const { getTrackNetResult, waitForTrackNet } = await import("@/lib/tracknet-client");
          await waitForTrackNet(
            nextJob.jobId,
            (nextProgress, nextEtaSeconds) => {
              if (runTokenRef.current !== token) return;
              setPhase(nextProgress > 0 ? "processing" : "queued");
              setProgress(nextProgress);
              setEtaSeconds(nextEtaSeconds ?? null);
            },
            controller.signal,
          );
          const nextResult = await getTrackNetResult(nextJob.jobId, controller.signal);
          if (runTokenRef.current !== token) return;
          setProgress(1);
          setEtaSeconds(null);
          setResult(nextResult);
          setPhase("completed");
        } catch (pollError) {
          if (runTokenRef.current !== token) return;
          const missingJob =
            options?.clearMissingJob &&
            pollError instanceof Error &&
            pollError.message.includes("404");
          if (missingJob) {
            setJob(null);
            setPhase("idle");
            setProgress(0);
            setEtaSeconds(null);
            setResult(null);
            setError(null);
            storeJob(null);
            return;
          }
          setPhase("failed");
          setEtaSeconds(null);
          setError(pollError instanceof Error ? pollError.message : "TrackNet analysis failed.");
        }
      })();
    },
    [],
  );

  useEffect(() => {
    const storedJob = readStoredJob();
    if (!storedJob) return;
    setJob(storedJob);
    pollJob(storedJob, { clearMissingJob: true });
  }, [pollJob]);

  useEffect(
    () => () => {
      ++runTokenRef.current;
      abortRef.current?.abort();
    },
    [],
  );

  const start = useCallback(
    async (file: File) => {
      const token = ++runTokenRef.current;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setPhase("uploading");
      setProgress(0);
      setEtaSeconds(null);
      setResult(null);
      setError(null);
      try {
        const { submitTrackNetVideo } = await import("@/lib/tracknet-client");
        const { jobId } = await submitTrackNetVideo(file, controller.signal);
        if (runTokenRef.current !== token) return;
        const nextJob = { jobId, fileName: file.name, startedAt: Date.now() };
        setJob(nextJob);
        storeJob(nextJob);
        setPhase("queued");
        pollJob(nextJob);
      } catch (startError) {
        if (runTokenRef.current !== token) return;
        setPhase("failed");
        setError(startError instanceof Error ? startError.message : "TrackNet upload failed.");
      }
    },
    [pollJob],
  );

  const clear = useCallback(() => {
    ++runTokenRef.current;
    abortRef.current?.abort();
    setJob(null);
    setPhase("idle");
    setProgress(0);
    setEtaSeconds(null);
    setResult(null);
    setError(null);
    storeJob(null);
  }, []);

  return (
    <TrackNetAnalysisContext.Provider
      value={{ job, phase, progress, etaSeconds, result, error, start, clear }}
    >
      {children}
    </TrackNetAnalysisContext.Provider>
  );
}

export function useTrackNetAnalysis() {
  const context = useContext(TrackNetAnalysisContext);
  if (!context) {
    throw new Error("useTrackNetAnalysis must be used inside TrackNetAnalysisProvider");
  }
  return context;
}
