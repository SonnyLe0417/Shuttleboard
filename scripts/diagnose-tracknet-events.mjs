/** Replay the app's rally detector against saved, labelled video clips. */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createRallyEndState, updateRallyEndState } from "../src/lib/rally-end-detector.ts";
import { isDirectTrackNetDetection } from "../src/lib/tracknet-evidence.ts";

export function replayTrackNetPoints(points, sourceOffset = 0) {
  if (!Number.isFinite(sourceOffset) || sourceOffset < 0) throw new Error("Invalid source offset.");
  const provenanceAware = points.some((point) =>
    point.detected !== undefined || point.repaired !== undefined);
  let state = createRallyEndState();
  let previousTime = -Infinity;
  let evidenceFrames = 0;
  let directFrames = 0;
  let repairedFrames = 0;
  const proposals = [];
  const phaseTransitions = [];
  for (const point of points) {
    if (!Number.isFinite(point.time) || point.time < previousTime)
      throw new Error("Coordinate times must be finite and ordered.");
    previousTime = point.time;
    const direct = isDirectTrackNetDetection(point);
    if (direct) directFrames++;
    else if (point.visible && point.repaired === true) repairedFrames++;
    const sample = {
      time: point.time,
      x: direct ? point.x : null,
      y: direct ? point.y : null,
      visible: direct,
      confidence: direct ? point.confidence : 0,
      cameraStable: true,
    };
    const oldPhase = state.phase;
    const updated = updateRallyEndState(state, sample, { directDetectionGaps: provenanceAware });
    state = updated.state;
    const event = updated.event;
    const startsNextRally = Boolean(event && direct && event.point.time < sample.time);
    if (direct && !startsNextRally) evidenceFrames++;
    if (oldPhase !== state.phase || event) {
      phaseTransitions.push({
        time: sourceOffset + point.time,
        from: oldPhase,
        to: state.phase,
        event: event?.type ?? null,
        direct,
      });
    }
    if (!event) continue;
    proposals.push({
      id: proposals.length + 1,
      emittedTime: sourceOffset + sample.time,
      lastSeenTime: sourceOffset + event.point.time,
      type: event.type,
      reasons: event.reasons,
      evidenceFrames,
      confidence: event.point.confidence,
      lastSeenX: event.point.x,
      lastSeenY: event.point.y,
      gapEnding: event.reasons.some((reason) => reason.includes("Direct shuttle detections disappeared")),
    });
    evidenceFrames = startsNextRally ? 1 : 0;
  }
  return {
    provenanceAware,
    totalFrames: points.length,
    directOrLegacyVisibleFrames: directFrames,
    repairedFrames,
    missingFrames: points.length - directFrames - repairedFrames,
    proposals,
    phaseTransitions,
  };
}

function better(first, second) {
  if (first.matches !== second.matches) return first.matches > second.matches ? first : second;
  return first.error <= second.error ? first : second;
}

/** Maximize one-to-one matches, then minimize total absolute time error. */
export function matchProposals(labels, proposals, { coreStart, coreEnd, tolerance = 2 }) {
  if (![coreStart, coreEnd, tolerance].every(Number.isFinite) || coreEnd <= coreStart || tolerance < 0)
    throw new Error("Invalid evaluation interval or tolerance.");
  const eligibleLabels = labels.filter((label) => Number.isFinite(label.end) &&
    label.end >= coreStart && label.end <= coreEnd).sort((a, b) => a.end - b.end);
  const eligibleEvents = proposals.filter((event) => event.emittedTime >= coreStart &&
    event.emittedTime <= coreEnd).sort((a, b) => a.emittedTime - b.emittedTime);
  const n = eligibleLabels.length;
  const m = eligibleEvents.length;
  const dp = Array.from({ length: n + 1 }, () => Array(m + 1));
  dp[0][0] = { matches: 0, error: 0, pairs: [] };
  for (let i = 0; i <= n; i++) {
    for (let j = 0; j <= m; j++) {
      if (i === 0 && j === 0) continue;
      const choices = [];
      if (i > 0) choices.push(dp[i - 1][j]);
      if (j > 0) choices.push(dp[i][j - 1]);
      if (i > 0 && j > 0) {
        const error = Math.abs(eligibleLabels[i - 1].end - eligibleEvents[j - 1].emittedTime);
        if (error <= tolerance) {
          const prior = dp[i - 1][j - 1];
          choices.push({ matches: prior.matches + 1, error: prior.error + error,
            pairs: [...prior.pairs, [i - 1, j - 1]] });
        }
      }
      dp[i][j] = choices.reduce(better);
    }
  }
  const matchedLabelIds = new Set();
  const matchedEventIds = new Set();
  const matches = dp[n][m].pairs.map(([labelIndex, eventIndex]) => {
    const label = eligibleLabels[labelIndex];
    const event = eligibleEvents[eventIndex];
    matchedLabelIds.add(label.id);
    matchedEventIds.add(event.id);
    return { rallyId: label.id, proposalId: event.id,
      differenceSeconds: event.emittedTime - label.end,
      lastSeenDifferenceSeconds: event.lastSeenTime - label.end,
      uncertainEnd: Boolean(label.endUncertain) };
  });
  const unmatchedLabels = eligibleLabels.filter((label) => !matchedLabelIds.has(label.id));
  const classifiedProposals = proposals.map((event) => {
    if (event.emittedTime < coreStart || event.emittedTime > coreEnd)
      return { proposalId: event.id, status: "padding" };
    const match = matches.find((item) => item.proposalId === event.id);
    if (match) return { proposalId: event.id, status: "matched", rallyId: match.rallyId };
    const nearest = eligibleLabels.filter((label) =>
      Math.abs(label.end - event.emittedTime) <= tolerance)
      .sort((a, b) => Math.abs(a.end - event.emittedTime) - Math.abs(b.end - event.emittedTime))[0];
    return nearest
      ? { proposalId: event.id, status: "duplicate", rallyId: nearest.id }
      : { proposalId: event.id, status: "false_alarm" };
  });
  return {
    labelledRallies: eligibleLabels.length,
    clearLabelledRallies: eligibleLabels.filter((label) => !label.endUncertain).length,
    matched: matches.length,
    missed: unmatchedLabels.length,
    duplicates: classifiedProposals.filter((item) => item.status === "duplicate").length,
    falseAlarms: classifiedProposals.filter((item) => item.status === "false_alarm").length,
    matches,
    unmatchedLabels: unmatchedLabels.map((label) => label.id),
    classifiedProposals,
  };
}

function loadJson(path) { return JSON.parse(readFileSync(path, "utf8")); }

export function compareManifest(manifest) {
  const labels = loadJson(manifest.labelsPath);
  const clips = manifest.clips.map((clip) => {
    const sample = loadJson(clip.sampleMetadataPath);
    if (labels.sourceSha256 !== sample.source_content_sha256)
      throw new Error(`Source video fingerprint mismatch for ${clip.id}.`);
    const selectedLabels = labels.rallies.filter((label) => label.group === clip.id);
    const runs = clip.runs.map((run) => {
      const report = loadJson(run.benchmarkPath);
      if (report.status !== "completed" || report.input.content_sha256 !== sample.sample_content_sha256)
        throw new Error(`Run is incomplete or input video differs: ${run.benchmarkPath}`);
      const points = loadJson(resolve(run.benchmarkPath, "..", "coordinates.json"));
      if (points.length !== report.frames) throw new Error("Coordinate count differs from the run report.");
      const replay = replayTrackNetPoints(points, sample.start_seconds);
      return {
        engine: report.engine, settings: report.settings, timing: report.timing,
        memory: report.memory, inputSha256: report.input.content_sha256,
        replay,
        comparison: matchProposals(selectedLabels, replay.proposals,
          { coreStart: clip.coreStart, coreEnd: clip.coreEnd }),
      };
    });
    return { id: clip.id, sample, coreStart: clip.coreStart, coreEnd: clip.coreEnd,
      labels: selectedLabels, runs };
  });
  return { schemaVersion: 1, sourceSha256: labels.sourceSha256, clips };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [manifestPath, outputPath] = process.argv.slice(2);
  if (!manifestPath || !outputPath) {
    console.error("Usage: node --import ./scripts/register-typescript.mjs scripts/diagnose-tracknet-events.mjs MANIFEST.json OUTPUT.json");
    process.exitCode = 2;
  } else {
    const result = compareManifest(loadJson(resolve(manifestPath)));
    writeFileSync(resolve(outputPath), JSON.stringify(result, null, 2) + "\n", { flag: "wx" });
    console.log(`Compared ${result.clips.length} clips: ${outputPath}`);
  }
}
