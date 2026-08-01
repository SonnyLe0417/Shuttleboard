// Shared shuttle-motion detector used by the live camera page and the
// uploaded-video analyzer. Pure function: give it two consecutive grayscale
// frames plus RGBA of the current one and it returns the best-guess track.

export interface LocalTrack {
  x: number;
  y: number;
  vx: number;
  vy: number;
  ax: number;
  ay: number;
  lastSeen: number;
  updatedAt: number;
  confidence: number;
  /** Normalized position uncertainty. Smaller means a tighter lock. */
  uncertainty: number;
  visible: boolean;
  hits: number;
}

export interface LocalCandidate {
  x: number;
  y: number;
  score: number;
  confidence: number;
  distance: number;
  area: number;
  brightness: number;
  aspect: number;
}

export interface LocalDetection {
  track: LocalTrack | null;
  gray: Uint8ClampedArray;
  cameraShift: { x: number; y: number };
  candidates: LocalCandidate[];
  motionPixels: number;
  searchRadius: number;
  prediction: Point;
  confidenceReasons: string[];
}

export type Point = { x: number; y: number };

// Higher resolution → the shuttle occupies more pixels so it survives the
// motion/size filters even from across the court.
export const LOCAL_TRACK_WIDTH = 640;
export const LOCAL_TRACK_MIN_CONFIDENCE = 0.14;
// Coast the last known position for ~700ms of occlusion before declaring lost.
export const LOCAL_TRACK_COAST_MS = 700;
// Normalized coordinates are 0..1. These limits prevent a background blob
// from teleporting the lock across the frame between two camera frames.
const MAX_STEP_PER_MS_UNLOCKED = 0.006;
const MAX_STEP_PER_MS_LOCKED = 0.018; // allow fast smashes without losing the lock
const ACQUIRE_HITS = 2;
const LOCKED_HITS = 5;
const LOCKED_SEARCH_RADIUS = 0.4;
const COAST_SEARCH_RADIUS = 0.62;
const MAX_ACCELERATION_PER_MS2 = 0.00004;

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

function pointInPolygon(x: number, y: number, polygon: readonly Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    const crosses = a.y > y !== b.y > y;
    if (crosses && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y + 1e-9) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

function estimateCameraShift(
  current: Uint8ClampedArray,
  previous: Uint8ClampedArray,
  width: number,
  height: number,
): { x: number; y: number } {
  const sampleStep = 12;
  const maxShift = 6;
  let bestDx = 0;
  let bestDy = 0;
  let zeroScore = Number.POSITIVE_INFINITY;
  let bestScore = Number.POSITIVE_INFINITY;

  for (let dy = -maxShift; dy <= maxShift; dy++) {
    for (let dx = -maxShift; dx <= maxShift; dx++) {
      let score = 0;
      let samples = 0;
      for (let y = sampleStep; y < height - sampleStep; y += sampleStep) {
        for (let x = sampleStep; x < width - sampleStep; x += sampleStep) {
          // Skip the center where the shuttle and players are most likely to be.
          if (x > width * 0.24 && x < width * 0.76 && y > height * 0.18 && y < height * 0.84) {
            continue;
          }
          const previousX = Math.max(0, Math.min(width - 1, x - dx));
          const previousY = Math.max(0, Math.min(height - 1, y - dy));
          score += Math.abs(current[y * width + x] - previous[previousY * width + previousX]);
          samples++;
        }
      }
      const average = samples ? score / samples : Number.POSITIVE_INFINITY;
      if (dx === 0 && dy === 0) zeroScore = average;
      if (average < bestScore) {
        bestScore = average;
        bestDx = dx;
        bestDy = dy;
      }
    }
  }

  // Do not chase random sensor noise when the no-shift comparison is already
  // essentially as good as the best translated comparison.
  if (!Number.isFinite(zeroScore) || bestScore > zeroScore * 0.98) {
    return { x: 0, y: 0 };
  }
  return { x: bestDx, y: bestDy };
}

export function detectBirdieMotion(
  rgba: Uint8ClampedArray,
  previousGray: Uint8ClampedArray | null,
  prior: LocalTrack | null,
  width: number,
  height: number,
  now: number,
  searchPolygon?: readonly Point[],
): LocalDetection {
  const length = width * height;
  const gray = new Uint8ClampedArray(length);

  for (let i = 0, j = 0; i < rgba.length; i += 4, j++) {
    gray[j] = Math.round(rgba[i] * 0.34 + rgba[i + 1] * 0.44 + rgba[i + 2] * 0.22);
  }

  const courtPolygon = searchPolygon && searchPolygon.length >= 3 ? searchPolygon : null;
  if (courtPolygon && prior && !pointInPolygon(prior.x, prior.y, courtPolygon)) {
    prior = null;
  }

  if (!previousGray) {
    return {
      gray,
      track: prior,
      cameraShift: { x: 0, y: 0 },
      candidates: [],
      motionPixels: 0,
      searchRadius: 1,
      prediction: { x: prior?.x ?? 0.5, y: prior?.y ?? 0.5 },
      confidenceReasons: prior ? ["warming up motion history"] : ["waiting for a second frame"],
    };
  }

  const cameraShiftPx = estimateCameraShift(gray, previousGray, width, height);
  const cameraShift = { x: cameraShiftPx.x / width, y: cameraShiftPx.y / height };
  if (prior) {
    prior = {
      ...prior,
      x: clamp01(prior.x + cameraShift.x),
      y: clamp01(prior.y + cameraShift.y),
    };
  }
  const previousAt = (index: number) => {
    const x = index % width;
    const y = Math.floor(index / width);
    const previousX = Math.max(0, Math.min(width - 1, x - cameraShiftPx.x));
    const previousY = Math.max(0, Math.min(height - 1, y - cameraShiftPx.y));
    return previousGray[previousY * width + previousX];
  };

  // "Locked": we've had multiple consecutive good detections — trust the prior
  // strongly, widen search, and drop the motion threshold to keep the lock.
  const locked = !!(
    prior &&
    prior.hits >= LOCKED_HITS &&
    now - prior.lastSeen < LOCAL_TRACK_COAST_MS
  );
  const recentPrior = prior && now - prior.updatedAt < LOCAL_TRACK_COAST_MS ? prior : null;
  const dtPredict = recentPrior ? Math.min(220, now - recentPrior.updatedAt) : 0;
  const predictedX = recentPrior
    ? clamp01(
        recentPrior.x + recentPrior.vx * dtPredict + 0.5 * recentPrior.ax * dtPredict * dtPredict,
      )
    : 0.5;
  const predictedY = recentPrior
    ? clamp01(
        recentPrior.y + recentPrior.vy * dtPredict + 0.5 * recentPrior.ay * dtPredict * dtPredict,
      )
    : 0.5;
  const speed = recentPrior ? Math.hypot(recentPrior.vx, recentPrior.vy) : 0;
  // Locked tracker uses a much bigger cone so smashes don't slip outside.
  const searchRadius = locked
    ? Math.min(LOCKED_SEARCH_RADIUS, 0.18 + speed * 110)
    : recentPrior
      ? Math.min(COAST_SEARCH_RADIUS, 0.18 + speed * 130)
      : 1;
  const mask = new Uint8Array(length);
  const visited = new Uint8Array(length);
  let motionPixels = 0;
  const threshold = locked ? 14 : recentPrior ? 18 : 26;

  const minSearchX = courtPolygon
    ? Math.max(0, Math.floor(Math.min(...courtPolygon.map((point) => point.x)) * width))
    : 0;
  const maxSearchX = courtPolygon
    ? Math.min(width - 1, Math.ceil(Math.max(...courtPolygon.map((point) => point.x)) * width))
    : width - 1;
  const minSearchY = courtPolygon
    ? Math.max(0, Math.floor(Math.min(...courtPolygon.map((point) => point.y)) * height))
    : 0;
  const maxSearchY = courtPolygon
    ? Math.min(height - 1, Math.ceil(Math.max(...courtPolygon.map((point) => point.y)) * height))
    : height - 1;

  const markMotion = (x: number, y: number) => {
    const i = y * width + x;
    const diff = Math.abs(gray[i] - previousAt(i));
    if (diff > threshold && gray[i] > 60 && !mask[i]) {
      mask[i] = 1;
      motionPixels++;
    }
  };

  if (!courtPolygon) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) markMotion(x, y);
    }
  } else {
    // Scan each row between polygon-edge intersections. This creates the court
    // mask without running a point-in-polygon test for every 640px pixel.
    for (let y = minSearchY; y <= maxSearchY; y++) {
      const normalizedY = (y + 0.5) / height;
      const intersections: number[] = [];
      for (let i = 0, j = courtPolygon.length - 1; i < courtPolygon.length; j = i++) {
        const a = courtPolygon[i];
        const b = courtPolygon[j];
        if (a.y > normalizedY !== b.y > normalizedY) {
          intersections.push(a.x + ((normalizedY - a.y) * (b.x - a.x)) / (b.y - a.y));
        }
      }
      intersections.sort((a, b) => a - b);
      for (let i = 0; i + 1 < intersections.length; i += 2) {
        const startX = Math.max(minSearchX, Math.ceil(intersections[i] * width - 0.5));
        const endX = Math.min(maxSearchX, Math.floor(intersections[i + 1] * width - 0.5));
        for (let x = startX; x <= endX; x++) markMotion(x, y);
      }
    }
  }

  let best: LocalCandidate | null = null;
  const candidates: LocalCandidate[] = [];
  const stack: number[] = [];

  // Size gates scaled for 320px width — a shuttle from mid-court is ~5–15 px wide.
  const resolutionScale = width / 320;
  const areaScale = resolutionScale * resolutionScale;
  const MIN_AREA = Math.max(3, Math.round(3 * areaScale));
  const MAX_AREA = Math.round(260 * areaScale);
  const MAX_BOX = Math.round(34 * resolutionScale);

  for (let i = 0; i < length; i++) {
    if (!mask[i] || visited[i]) continue;

    let area = 0;
    let sumX = 0;
    let sumY = 0;
    let sumGray = 0;
    let sumR = 0;
    let sumG = 0;
    let sumB = 0;
    let weightTotal = 0;
    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;
    let maxDiff = 0;
    let maxBright = 0;
    stack.length = 0;
    stack.push(i);
    visited[i] = 1;

    while (stack.length) {
      const idx = stack.pop()!;
      const x = idx % width;
      const y = Math.floor(idx / width);
      const diff = Math.abs(gray[idx] - previousAt(idx));
      const weight = diff * (gray[idx] + 30);
      const rgbaIdx = idx * 4;
      const r = rgba[rgbaIdx];
      const g = rgba[rgbaIdx + 1];
      const b = rgba[rgbaIdx + 2];

      area++;
      sumX += x * weight;
      sumY += y * weight;
      sumGray += gray[idx];
      sumR += r;
      sumG += g;
      sumB += b;
      weightTotal += weight;
      maxDiff = Math.max(maxDiff, diff);
      maxBright = Math.max(maxBright, gray[idx]);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);

      const left = idx - 1;
      const right = idx + 1;
      const up = idx - width;
      const down = idx + width;
      if (x > 0 && mask[left] && !visited[left]) {
        visited[left] = 1;
        stack.push(left);
      }
      if (x < width - 1 && mask[right] && !visited[right]) {
        visited[right] = 1;
        stack.push(right);
      }
      if (y > 0 && mask[up] && !visited[up]) {
        visited[up] = 1;
        stack.push(up);
      }
      if (y < height - 1 && mask[down] && !visited[down]) {
        visited[down] = 1;
        stack.push(down);
      }
    }

    const boxW = maxX - minX + 1;
    const boxH = maxY - minY + 1;
    if (area < MIN_AREA || area > MAX_AREA || boxW > MAX_BOX || boxH > MAX_BOX || weightTotal <= 0)
      continue;
    const aspect = Math.max(boxW, boxH) / Math.min(boxW, boxH);
    if (aspect > 2.6) continue;
    const meanGray = sumGray / area;
    // Shuttles are lighter than most backgrounds but not required to be very bright.
    if (meanGray < 95 && maxBright < 160) continue;
    const fillRatio = area / (boxW * boxH);
    if (fillRatio < 0.28) continue;

    const meanR = sumR / area;
    const meanG = sumG / area;
    const meanB = sumB / area;
    const warmth = meanR - meanB;
    const skinLike = warmth > 18 && meanR > meanG && meanG > meanB - 4 && meanR < 235;
    if (skinLike) continue;
    const maxCh = Math.max(meanR, meanG, meanB);
    const minCh = Math.min(meanR, meanG, meanB);
    const saturation = maxCh - minCh;
    // Reject saturated colored objects (shirts) but keep white/yellow shuttles.
    if (saturation > 45 && meanGray < 190) continue;

    const cx = sumX / weightTotal / width;
    const cy = sumY / weightTotal / height;
    const distance = Math.hypot(cx - predictedX, cy - predictedY);
    if (recentPrior && distance > searchRadius) continue;

    // Strongly reward candidates near the predicted position when locked —
    // this is what keeps the ring "sticky" on the shuttle instead of drifting
    // to a wristband or racket head that flashes brighter for one frame.
    const distanceRefScale = locked ? 0.05 : 0.09;
    const distancePenalty = recentPrior
      ? 1 / (1 + (distance / distanceRefScale) * (distance / distanceRefScale))
      : 0.6;
    const compactBoost = 1 / Math.sqrt(Math.max(area, 1));
    const brightBoost = clamp01((meanGray - 80) / 140) * 0.9 + 0.4;
    const aspectBoost = 1 / aspect;
    const whitenessBoost = 1 + clamp01((45 - saturation) / 45) * 0.6;
    const lockStickiness = locked ? 1.6 : 1;
    const score =
      weightTotal *
        compactBoost *
        distancePenalty *
        brightBoost *
        aspectBoost *
        whitenessBoost *
        lockStickiness +
      maxDiff * 60 * resolutionScale;
    const rawConfidence = clamp01(score / (8000 * resolutionScale));

    const candidate = {
      x: cx,
      y: cy,
      score,
      confidence: rawConfidence,
      distance,
      area,
      brightness: meanGray,
      aspect,
    };
    candidates.push(candidate);
    if (!best || score > best.score) best = candidate;
  }

  if (best && best.confidence >= LOCAL_TRACK_MIN_CONFIDENCE) {
    candidates.sort((a, b) => b.score - a.score);
    const runnerUp = candidates[1];
    const candidateMargin = runnerUp
      ? clamp01((best.score - runnerUp.score) / Math.max(best.score, 1))
      : 1;
    const dt = Math.max(16, prior ? now - prior.updatedAt : 16);
    const closeness = recentPrior ? clamp01(1 - best.distance / Math.max(searchRadius, 0.01)) : 0;
    // When locked and close to prediction, trust the new observation more so
    // the ring hugs the shuttle instead of lagging behind on smashes.
    const alpha = recentPrior
      ? locked
        ? Math.min(0.75, 0.45 + closeness * 0.25 + best.confidence * 0.15)
        : Math.min(0.6, 0.28 + (1 - closeness) * 0.25 + best.confidence * 0.15)
      : 1;
    let x = recentPrior ? clamp01(recentPrior.x * (1 - alpha) + best.x * alpha) : clamp01(best.x);
    let y = recentPrior ? clamp01(recentPrior.y * (1 - alpha) + best.y * alpha) : clamp01(best.y);
    // A held shuttle should settle to one readable point. Tiny changes in the
    // motion mask are sensor noise, not real movement, so keep the lock still
    // until the candidate clears a visible-motion threshold.
    if (recentPrior && best.distance < 0.018 && speed < 0.0018) {
      x = recentPrior.x;
      y = recentPrior.y;
    }
    if (prior) {
      const maxStep = (locked ? MAX_STEP_PER_MS_LOCKED : MAX_STEP_PER_MS_UNLOCKED) * dt;
      const dx = x - prior.x;
      const dy = y - prior.y;
      const step = Math.hypot(dx, dy);
      if (step > maxStep) {
        const k = maxStep / step;
        x = clamp01(prior.x + dx * k);
        y = clamp01(prior.y + dy * k);
      }
    }
    const rawVx = prior ? (x - prior.x) / dt : 0;
    const rawVy = prior ? (y - prior.y) / dt : 0;
    const vAlpha = locked ? 0.5 : 0.35;
    const vx = prior ? prior.vx * (1 - vAlpha) + rawVx * vAlpha : 0;
    const vy = prior ? prior.vy * (1 - vAlpha) + rawVy * vAlpha : 0;
    const rawAx = prior ? (vx - prior.vx) / dt : 0;
    const rawAy = prior ? (vy - prior.vy) / dt : 0;
    const ax = prior
      ? Math.max(
          -MAX_ACCELERATION_PER_MS2,
          Math.min(MAX_ACCELERATION_PER_MS2, prior.ax * 0.7 + rawAx * 0.3),
        )
      : 0;
    const ay = prior
      ? Math.max(
          -MAX_ACCELERATION_PER_MS2,
          Math.min(MAX_ACCELERATION_PER_MS2, prior.ay * 0.7 + rawAy * 0.3),
        )
      : 0;
    const hits = (prior?.hits ?? 0) + 1;
    const stability = clamp01(hits / 6);
    const measurementUncertainty = clamp01(
      0.04 + best.distance * 0.35 + (1 - candidateMargin) * 0.18 + (1 - best.confidence) * 0.12,
    );
    const uncertainty = prior
      ? clamp01((prior.uncertainty ?? 0.18) * 0.35 + measurementUncertainty * 0.65)
      : measurementUncertainty;
    const target = clamp01(
      best.confidence * 0.55 + candidateMargin * 0.2 + closeness * 0.15 + stability * 0.2,
    );
    const priorConf = prior?.confidence ?? 0;
    const confidence = clamp01(prior ? priorConf * 0.55 + target * 0.45 : target);
    const confidenceReasons = [
      recentPrior
        ? closeness > 0.65
          ? "near predicted path"
          : "corrected toward a new candidate"
        : "found during full-court scan",
      candidateMargin > 0.45 ? "one clear candidate" : "competing candidates nearby",
      best.brightness > 170 ? "bright shuttle-like target" : "low-light target",
      uncertainty < 0.12 ? "tight position estimate" : "wide position estimate",
    ];
    return {
      gray,
      cameraShift,
      candidates: candidates.slice(0, 5),
      motionPixels,
      searchRadius,
      prediction: { x: predictedX, y: predictedY },
      confidenceReasons,
      track: {
        x,
        y,
        vx,
        vy,
        ax,
        ay,
        lastSeen: now,
        updatedAt: now,
        confidence: Math.min(0.98, confidence),
        uncertainty,
        visible: hits >= ACQUIRE_HITS || Boolean(recentPrior),
        hits,
      },
    };
  }

  // Coasting: no fresh detection this frame, but the shuttle was just here —
  // keep projecting the last velocity so the ring stays on target through
  // brief occlusions (racket swings, motion blur, background clutter).
  if (prior && now - prior.lastSeen < LOCAL_TRACK_COAST_MS) {
    const age = now - prior.lastSeen;
    const dt = Math.min(160, now - prior.updatedAt);
    // Slow confidence decay so the lock survives short gaps.
    const decayCurve = Math.max(0, 1 - Math.pow(age / LOCAL_TRACK_COAST_MS, 1.8));
    const confidence = Math.max(
      prior.confidence * decayCurve,
      LOCAL_TRACK_MIN_CONFIDENCE * decayCurve,
    );
    const velDecay = locked ? 0.94 : 0.85;
    return {
      gray,
      cameraShift: cameraShiftPx,
      candidates: [],
      motionPixels,
      searchRadius,
      prediction: { x: predictedX, y: predictedY },
      confidenceReasons: ["coasting from last reliable position", "no fresh candidate this frame"],
      track: {
        ...prior,
        x: clamp01(prior.x + prior.vx * dt),
        y: clamp01(prior.y + prior.vy * dt),
        vx: prior.vx * velDecay,
        vy: prior.vy * velDecay,
        ax: prior.ax * velDecay,
        ay: prior.ay * velDecay,
        updatedAt: now,
        confidence,
        uncertainty: clamp01((prior.uncertainty ?? 0.18) + 0.025 + age / 24000),
        visible: confidence > LOCAL_TRACK_MIN_CONFIDENCE * 0.6,
      },
    };
  }

  return {
    gray,
    track: null,
    cameraShift: cameraShiftPx,
    candidates: candidates.slice(0, 5),
    motionPixels,
    searchRadius,
    prediction: { x: predictedX, y: predictedY },
    confidenceReasons: ["no candidate passed shuttle filters", "searching the full allowed zone"],
  };
}

// ---------- 4-point homography (image quad → unit square [0..1]²) ----------

// Solves the 8x8 linear system for a general homography that maps
// srcPts[0..3] → dstPts[0..3]. Returns a 9-element row-major 3x3 matrix.
export function computeHomography(src: Point[], dst: Point[]): number[] {
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const { x: sx, y: sy } = src[i];
    const { x: dx, y: dy } = dst[i];
    A.push([sx, sy, 1, 0, 0, 0, -dx * sx, -dx * sy]);
    b.push(dx);
    A.push([0, 0, 0, sx, sy, 1, -dy * sx, -dy * sy]);
    b.push(dy);
  }
  // Gaussian elimination
  const n = 8;
  for (let i = 0; i < n; i++) {
    let pivot = i;
    for (let r = i + 1; r < n; r++) {
      if (Math.abs(A[r][i]) > Math.abs(A[pivot][i])) pivot = r;
    }
    [A[i], A[pivot]] = [A[pivot], A[i]];
    [b[i], b[pivot]] = [b[pivot], b[i]];
    const div = A[i][i] || 1e-9;
    for (let c = i; c < n; c++) A[i][c] /= div;
    b[i] /= div;
    for (let r = 0; r < n; r++) {
      if (r === i) continue;
      const factor = A[r][i];
      if (!factor) continue;
      for (let c = i; c < n; c++) A[r][c] -= factor * A[i][c];
      b[r] -= factor * b[i];
    }
  }
  return [b[0], b[1], b[2], b[3], b[4], b[5], b[6], b[7], 1];
}

export function applyHomography(H: number[], p: Point): Point {
  const w = H[6] * p.x + H[7] * p.y + H[8];
  return {
    x: (H[0] * p.x + H[1] * p.y + H[2]) / w,
    y: (H[3] * p.x + H[4] * p.y + H[5]) / w,
  };
}
