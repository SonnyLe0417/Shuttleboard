import { Clock3, ListVideo, Sparkles, Target, Trophy } from "lucide-react";
import type { TrackNetPoint } from "@/lib/tracknet-client";
import { summarizeTrackNetFrames, type TrackNetFrameDiagnostics } from "@/lib/tracknet-evidence";
import {
  EMPTY_RALLIES_MESSAGE,
  averageTrackNetConfidence,
  countTrackNetDetections,
  formatAnalysisTime,
  getDownloadFileName,
  type AnalysisRally,
  type AnalysisRallyPatch,
  type AnalysisScore,
  type RallyReviewFilter,
  reviewFilterMatches,
  rallyDiagnostics,
  sparseRallyWarning,
} from "@/lib/analysis-results";
import { useState } from "react";

interface AnalysisResultsPanelProps {
  rallies: AnalysisRally[];
  score: AnalysisScore;
  tracknetPoints?: TrackNetPoint[];
  frameDiagnostics?: TrackNetFrameDiagnostics;
  processedVideoUrl?: string | null;
  selectedRally: number | null;
  onSelectRally: (rally: AnalysisRally) => void;
  onCorrectRally: (id: number, patch: AnalysisRallyPatch) => void;
  onSetReviewStatus: (id: number, status: "needs-review" | "confirmed" | "corrected") => void;
}

export function AnalysisResultsPanel({
  rallies,
  score,
  tracknetPoints,
  frameDiagnostics,
  processedVideoUrl,
  selectedRally,
  onSelectRally,
  onCorrectRally,
  onSetReviewStatus,
}: AnalysisResultsPanelProps) {
  const [reviewFilter, setReviewFilter] = useState<RallyReviewFilter>("all");
  const isTrackNet = tracknetPoints !== undefined;
  const detections = countTrackNetDetections(tracknetPoints);
  const hasScoredRallies = rallies.length > 0;
  const confidence = isTrackNet
    ? averageTrackNetConfidence(tracknetPoints)
    : rallies.length
      ? Math.round(
          (rallies.reduce((total, rally) => total + (rally.aiConfidence || 0.7), 0) /
            rallies.length) *
            100,
        )
      : 0;
  const winner =
    score.p1 === score.p2 ? "Even match" : score.p1 > score.p2 ? "Player 1 led" : "Player 2 led";
  const visibleRallies = rallies.filter((rally) => reviewFilterMatches(rally, reviewFilter));
  const endings = rallyDiagnostics(rallies);
  const frames = frameDiagnostics ?? summarizeTrackNetFrames(tracknetPoints ?? []);
  const warning = isTrackNet ? sparseRallyWarning(frames, rallies) : null;

  return (
    <>
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
            label={isTrackNet && !hasScoredRallies ? "Detector" : "Confirmed point score"}
            value={isTrackNet && !hasScoredRallies ? "TrackNet ready" : winner}
            detail={
              isTrackNet && !hasScoredRallies ? "Processed video ready" : `${score.p1}-${score.p2}`
            }
          />
          <SummaryMetric
            icon={<ListVideo />}
            label={isTrackNet && !hasScoredRallies ? "Shuttle positions" : "Possible rally endings"}
            value={`${isTrackNet && !hasScoredRallies ? detections : rallies.length}`}
            detail={
              isTrackNet && !hasScoredRallies
                ? "frames with positions"
                : "includes moments needing review"
            }
          />
          <SummaryMetric
            icon={<Clock3 />}
            label={isTrackNet ? "Direct detection score" : "AI confidence"}
            value={`${confidence}%`}
            detail={
              isTrackNet
                ? "Model strength, not scoring accuracy"
                : `${rallies.filter((rally) => rally.aiConfidence > 0).length} AI checks`
            }
          />
        </div>
        {isTrackNet && (
          <div className="mt-4 rounded-xl border border-primary/15 bg-background/30 p-3">
            <p className="text-xs font-semibold">Tracking and rally checks</p>
            <dl className="mt-2 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
              {(
                [
                  ["Total frames", frames.totalFrames],
                  ["Direct detections", frames.directFrames],
                  ["Repaired positions", frames.repairedFrames],
                  ["Missing positions", frames.missingFrames],
                  ["Possible endings", endings.possibleEndings],
                  ["Confirmed endings", endings.confirmedEndings],
                  ["Needs review", endings.needsReview],
                ] as const
              ).map(([label, count]) => (
                <div key={label}>
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd>{count}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-2 text-[11px] text-muted-foreground">
              Possible endings include confirmed and reviewable events. Repaired positions stay in
              the video trail; only direct detections support rally decisions. Older results without
              detection labels treat visible positions as direct detections.
            </p>
            {warning && (
              <p role="status" className="mt-2 text-xs text-amber-300">
                {warning}
              </p>
            )}
          </div>
        )}
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-primary/15 bg-background/30 p-3">
            <p className="text-xs font-semibold text-primary">What went well</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              {isTrackNet && hasScoredRallies
                ? `TrackNet found ${rallies.length} possible rally endings. ${endings.confirmedEndings} count toward the score and ${endings.needsReview} still need review.`
                : isTrackNet
                  ? "The processed video is ready with TrackNet shuttle markers for review."
                  : "Your strongest moments are now grouped in the timeline so you can revisit successful rallies."}
            </p>
          </div>
          <div className="rounded-xl border border-white/10 bg-background/30 p-3">
            <p className="text-xs font-semibold text-primary">Next drill</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              {isTrackNet && hasScoredRallies
                ? getNextPracticeSuggestion(rallies)
                : isTrackNet
                  ? "Review the processed video and confirm the court corners before scoring."
                  : getNextPracticeSuggestion(rallies)}
            </p>
          </div>
        </div>
      </section>

      {processedVideoUrl && (
        <a
          href={processedVideoUrl}
          download={getDownloadFileName()}
          target="_blank"
          rel="noreferrer"
          className="mt-2 inline-flex text-xs font-medium text-primary underline-offset-4 hover:underline"
        >
          Download TrackNet processed video ({detections} frames with shuttle positions)
        </a>
      )}

      <section className="mt-6 rounded-2xl border border-border bg-card">
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <ListVideo className="h-4 w-4 text-primary" />
          <div>
            <h2 className="text-sm font-semibold">Key moments</h2>
            <p className="text-[11px] text-muted-foreground">
              Select a rally to jump to that moment in the video.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5 border-b border-border px-4 py-3">
          {(["all", "needs-review", "confirmed", "corrected"] as const).map((filter) => (
            <button
              key={filter}
              type="button"
              onClick={() => setReviewFilter(filter)}
              className={`rounded-md px-2 py-1 text-[10px] font-semibold ${reviewFilter === filter ? "bg-primary text-primary-foreground" : "border border-input text-muted-foreground"}`}
            >
              {filter === "all"
                ? "All rallies"
                : filter === "needs-review"
                  ? "Needs review"
                  : filter[0].toUpperCase() + filter.slice(1)}
            </button>
          ))}
        </div>
        {rallies.length === 0 ? (
          <p className="px-4 py-6 text-center text-xs text-muted-foreground">
            {EMPTY_RALLIES_MESSAGE}
          </p>
        ) : visibleRallies.length === 0 ? (
          <p className="px-4 py-6 text-center text-xs text-muted-foreground">
            No rallies match this filter.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {visibleRallies.map((rally) => (
              <li
                key={rally.id}
                className={`flex cursor-pointer items-center justify-between gap-3 px-4 py-3 text-sm transition-colors ${selectedRally === rally.id ? "bg-primary/10" : "hover:bg-accent/40"}`}
                onClick={() => onSelectRally(rally)}
                role="button"
                tabIndex={0}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onSelectRally(rally);
                  }
                }}
              >
                <div>
                  <p className="font-medium">
                    Rally #{rally.id} —{" "}
                    {rally.countsTowardScore === false ? "Suggested winner: " : "Point to "}
                    {rally.winner === "p1" ? "Player 1" : "Player 2"}
                  </p>
                  {rally.needsReview &&
                    rally.reviewStatus !== "confirmed" &&
                    rally.reviewStatus !== "corrected" && (
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-300">
                          Needs review
                        </span>
                        <span className="text-[10px] text-amber-200/80">
                          {rally.reviewReasons?.join(" ") ?? "The landing evidence is uncertain."}
                        </span>
                      </div>
                    )}
                  {rally.reviewStatus === "confirmed" && (
                    <span className="mt-1 inline-flex rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold text-primary">
                      Confirmed
                    </span>
                  )}
                  {rally.reviewStatus === "corrected" && (
                    <span className="mt-1 inline-flex rounded-full bg-blue-500/15 px-2 py-0.5 text-[10px] font-semibold text-blue-200">
                      Corrected
                    </span>
                  )}
                  <p className="text-xs text-muted-foreground">
                    {formatAnalysisTime(rally.t)} ·{" "}
                    {rally.offCamera ? "Last observed position" : "Landing"}{" "}
                    {rally.inBounds ? "in" : "out"} ·{" "}
                    {rally.aiConfidence > 0 ? `AI ${Math.round(rally.aiConfidence * 100)}% — ` : ""}
                    {rally.aiNote}
                  </p>
                  <div
                    className="mt-2 flex flex-wrap items-center gap-1.5"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <span className="text-[10px] text-muted-foreground">Correct:</span>
                    {(["p1", "p2"] as const).map((player) => (
                      <button
                        key={player}
                        type="button"
                        onClick={() => onCorrectRally(rally.id, { winner: player })}
                        className={`rounded border px-1.5 py-0.5 text-[10px] ${rally.winner === player ? "border-primary/40 bg-primary/10 text-primary" : "border-white/10 text-muted-foreground"}`}
                      >
                        {player.toUpperCase()}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => onCorrectRally(rally.id, { inBounds: !rally.inBounds })}
                      className="rounded border border-white/10 px-1.5 py-0.5 text-[10px] text-muted-foreground"
                    >
                      {rally.inBounds ? "Mark OUT" : "Mark IN"}
                    </button>
                    <select
                      value={rally.shotType ?? "unknown"}
                      onChange={(event) =>
                        onCorrectRally(rally.id, {
                          shotType: event.target.value as AnalysisRally["shotType"],
                        })
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
                    {rally.manuallyCorrected && (
                      <span className="text-[10px] font-semibold text-primary">Edited</span>
                    )}
                    <button
                      type="button"
                      onClick={() => onSetReviewStatus(rally.id, "confirmed")}
                      className="rounded border border-primary/30 px-1.5 py-0.5 text-[10px] text-primary"
                    >
                      Confirm rally
                    </button>
                    <button
                      type="button"
                      onClick={() => onSetReviewStatus(rally.id, "needs-review")}
                      className="rounded border border-amber-500/30 px-1.5 py-0.5 text-[10px] text-amber-200"
                    >
                      Keep for review
                    </button>
                  </div>
                </div>
                <span
                  className={`rounded-full px-2 py-1 text-[10px] font-semibold ${rally.winner === "p1" ? "bg-primary/15 text-primary" : "bg-accent text-accent-foreground"}`}
                >
                  {rally.winner.toUpperCase()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function getNextPracticeSuggestion(rallies: AnalysisRally[]) {
  if (!rallies.length) return "Upload a longer clip to generate a more specific drill.";
  const outCount = rallies.filter((rally) => !rally.inBounds).length;
  const lowConfidence = rallies.filter(
    (rally) => rally.aiConfidence > 0 && rally.aiConfidence < 0.8,
  ).length;
  const labeled = rallies.filter((rally) => rally.shotType && rally.shotType !== "unknown");
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
