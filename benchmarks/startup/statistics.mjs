export function improvementPercent(before, after) {
  return before.n > 0 &&
    after.n > 0 &&
    Number.isFinite(before.median) &&
    Number.isFinite(after.median) &&
    after.median >= 0 &&
    before.median > 0
    ? (100 * (before.median - after.median)) / before.median
    : null;
}

export function meetsReadinessTarget(metric, beforeFailures, afterFailures) {
  return (
    metric.baseline.n === 10 &&
    metric.optimized.n === 10 &&
    beforeFailures === 0 &&
    afterFailures === 0 &&
    Number.isFinite(metric.improvementPercent) &&
    metric.improvementPercent >= 20
  );
}
