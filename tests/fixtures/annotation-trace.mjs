// Turns a hand-labelled match into the coordinate rows TrackNet would return.
// Every rally gets a serve from the server's end, alternating shots, and a
// landing that matches how the annotator says it ended. Between rallies the
// shuttle lies still, is carried to the next server and held before the serve,
// which is exactly where false or duplicate rally endings come from.
import { computeHomography, applyHomography } from "../../src/lib/birdie-tracker.ts";
import { courtDestinationCorners } from "../../src/lib/court-calibration.ts";
import { annotatedLanding, nearPlayerAt, otherPlayer } from "../../src/lib/match-annotation.ts";
import { createTimeline, advanceTimeline } from "../../src/lib/match-timeline.ts";

// Image positions of the near-left, near-right, far-right and far-left corners
// for a camera raised behind the near baseline.
export const IMAGE_CORNERS = [
  { x: 0.14, y: 0.93 },
  { x: 0.86, y: 0.93 },
  { x: 0.7, y: 0.3 },
  { x: 0.3, y: 0.3 },
];
export const COURT_TO_IMAGE = computeHomography(courtDestinationCorners(), IMAGE_CORNERS);
export const IMAGE_TO_COURT = computeHomography(IMAGE_CORNERS, courtDestinationCorners());

const FPS = 30;
// TrackNetV3 reports positions on its 512x288 output grid.
const GRID_X = 512;
const GRID_Y = 288;
const SHOT_SECONDS = 1.1;
const FLOOR_REST_SECONDS = 3;
const CARRY_SECONDS = 4;
const HELD_SECONDS = 1.5;

function random(seed) {
  let value = (seed * 2654435761) >>> 0 || 1;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 2 ** 32;
  };
}

// A shuttlecock slows sharply after it is hit, so it covers most of the
// distance early and falls almost straight down at the end of its flight.
const along = (u) => 1 - (1 - u) ** 2.2;
const arc = (u) => {
  const w = u ** 0.6;
  return 4 * w * (1 - w);
};

function project(court, height = 0) {
  const image = applyHomography(COURT_TO_IMAGE, court);
  // Raised shuttles appear higher in the picture; less so at the far end.
  return { x: image.x, y: image.y - 0.075 * height * (0.4 + 0.6 * court.y) };
}

function inHalf(end, next, front = 0.08, back = 0.42) {
  const depth = front + (back - front) * next();
  return {
    x: 0.2 + 0.6 * next(),
    y: end === "far" ? 0.5 - depth : 0.5 + depth,
  };
}

function landingSpot(rally, landing, next) {
  const far = landing.end === "far";
  if (rally.ending === "net") return { x: 0.25 + 0.5 * next(), y: far ? 0.45 : 0.55 };
  if (landing.inCourt) return inHalf(landing.end, next, 0.15, 0.45);
  const note = rally.note.toLowerCase();
  if (note.includes("doubles") || note.includes("front")) {
    // Wide into the doubles alley: in for doubles, out for singles.
    const depth = note.includes("front") ? 0.1 : 0.3;
    return { x: next() < 0.5 ? 0.035 : 0.965, y: far ? 0.5 - depth : 0.5 + depth };
  }
  return { x: 0.3 + 0.4 * next(), y: far ? -0.04 : 1.04 };
}

function serveSpot(end, serverScore) {
  // Even score serves from the right court. The far player faces the camera,
  // so their right is the left of the picture.
  const right = serverScore % 2 === 0;
  const imageRight = end === "near" ? right : !right;
  return { x: imageRight ? 0.62 : 0.38, y: end === "near" ? 0.68 : 0.32 };
}

/**
 * @param {import("../../src/lib/match-annotation.ts").MatchAnnotation} annotation
 * @param {{ occludeRestEvery?: number, hideUnseenLandings?: boolean }} [options]
 */
export function traceFromAnnotation(annotation, options = {}) {
  const occludeEvery = options.occludeRestEvery ?? 4;
  const hideUnseen = options.hideUnseenLandings ?? true;
  const path = [];
  const add = (start, end, at) => path.push({ start, end, at });

  let timeline = createTimeline({ initialNear: annotation.initialNear });
  let server = annotation.rallies[0]?.winner ?? "p1";
  let lastLanding = null;
  for (const rally of annotation.rallies) {
    const next = random(rally.index + 1);
    const near = nearPlayerAt(annotation, rally.start);
    const endOf = (player) => (player === near ? "near" : "far");
    const serverEnd = endOf(server);
    const serveFrom = serveSpot(serverEnd, timeline.score[server]);

    // Dead time: the previous shuttle is carried over and held for the serve.
    if (lastLanding) {
      const carryStart = Math.max(
        lastLanding.restUntil,
        rally.start - HELD_SECONDS - CARRY_SECONDS,
      );
      const holdStart = rally.start - HELD_SECONDS;
      const from = lastLanding.spot;
      add(carryStart, holdStart, (u) =>
        project(
          { x: from.x + (serveFrom.x - from.x) * u, y: from.y + (serveFrom.y - from.y) * u },
          1,
        ),
      );
      add(holdStart, rally.start, () => project(serveFrom, 1));
    }

    const end = rally.end ?? rally.start + 5;
    const landing = rally.inferred ? null : annotatedLanding(rally, near);
    const lastHitter =
      rally.ending === "out" || rally.ending === "net" ? otherPlayer(rally.winner) : rally.winner;
    let shots = Math.max(1, Math.round((end - rally.start) / SHOT_SECONDS));
    const hitterOf = (shot) => (shot % 2 === 0 ? server : otherPlayer(server));
    if (hitterOf(shots - 1) !== lastHitter) shots += 1;
    const shotSeconds = (end - rally.start) / shots;

    let from = serveFrom;
    let fromHeight = 1;
    for (let shot = 0; shot < shots; shot++) {
      const hitter = hitterOf(shot);
      const receiverEnd = endOf(otherPlayer(hitter));
      const last = shot === shots - 1;
      const to = last && landing ? landingSpot(rally, landing, next) : inHalf(receiverEnd, next);
      const toHeight = last && landing ? 0 : 1.5 + next();
      const apex = shot === 0 ? 1.2 : [5, 0.6, 2][shot % 3];
      const start = rally.start + shot * shotSeconds;
      const a = from;
      const ha = fromHeight;
      add(start, start + shotSeconds, (u) =>
        project(
          { x: a.x + (to.x - a.x) * along(u), y: a.y + (to.y - a.y) * along(u) },
          ha * (1 - u) + toHeight * u + apex * arc(u),
        ),
      );
      from = to;
      fromHeight = toHeight;
    }

    const hidden = rally.inferred || (hideUnseen && !rally.landingVisible);
    const restUntil = end + FLOOR_REST_SECONDS;
    if (hidden) {
      // The landing is out of shot or blocked: nothing is seen until pickup.
      path.push({ start: end - 0.4, end: restUntil, at: () => null, override: true });
    } else {
      const spot = from;
      const occluded = occludeEvery > 0 && rally.index % occludeEvery === 0;
      add(end, restUntil, (u, t) => {
        if (occluded && t > end + 1.2 && t < end + 1.9) return null;
        // The detected blob centre of a resting shuttle flickers by a grid cell.
        const frame = Math.round(t * FPS);
        const image = project(spot);
        return {
          x: image.x + (frame % 7 === 0 ? 1 / GRID_X : 0),
          y: image.y + (frame % 11 === 0 ? 1 / GRID_Y : 0),
        };
      });
    }
    lastLanding = { spot: from, restUntil };

    const result = advanceTimeline(timeline, rally.winner);
    timeline = result.state;
    server = rally.winner;
  }

  const lastTime = path.reduce((max, segment) => Math.max(max, segment.end), 0);
  const points = [];
  for (let frame = 0; frame / FPS <= lastTime + 1; frame++) {
    const time = frame / FPS;
    let position = null;
    // Later segments (and hidden landings) take precedence over earlier ones.
    for (let i = path.length - 1; i >= 0; i--) {
      const segment = path[i];
      if (time < segment.start || time >= segment.end) continue;
      const u = (time - segment.start) / Math.max(segment.end - segment.start, 1e-6);
      position = segment.at(u, time);
      break;
    }
    const visible =
      position !== null && position.x >= 0 && position.x <= 1 && position.y >= 0 && position.y <= 1;
    points.push({
      frame,
      time,
      x: visible ? Math.round(position.x * GRID_X) / GRID_X : null,
      y: visible ? Math.round(position.y * GRID_Y) / GRID_Y : null,
      confidence: visible ? 0.9 : 0,
      visible,
      detected: visible,
      repaired: false,
    });
  }
  return { points, homography: IMAGE_TO_COURT };
}
