import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname, basename } from "node:path";
import { spawnSync } from "node:child_process";
import { assertNewOutputs, writeNewReport } from "../benchmarks/startup/output.mjs";
import { improvementPercent, meetsReadinessTarget } from "../benchmarks/startup/statistics.mjs";

test("missing or failed benchmark samples cannot claim a speedup or a met target", () => {
  const before = { n: 10, median: 100 },
    after = { n: 0, median: null };
  assert.equal(improvementPercent(before, after), null);
  const metric = { baseline: before, optimized: after, improvementPercent: null };
  assert.equal(meetsReadinessTarget(metric, 0, 10), false);
  const valid = { ...metric, optimized: { n: 10, median: 75 }, improvementPercent: 25 };
  assert.equal(meetsReadinessTarget(valid, 0, 0), true);
  assert.equal(meetsReadinessTarget({ ...valid, optimized: { n: 9, median: 75 } }, 0, 0), false);
  assert.equal(meetsReadinessTarget(valid, 0, 1), false);
});

test("benchmark output guards preserve history and reserve new reports exclusively", () => {
  const dir = mkdtempSync(join(tmpdir(), "shuttleboard-output-"));
  try {
    const original = join(dir, "old.json"),
      fresh = join(dir, "new.json");
    writeFileSync(original, "original");
    assert.throws(() => assertNewOutputs([fresh, original]), /already exists/);
    assert.throws(() => assertNewOutputs([fresh, fresh]), /distinct/);
    assertNewOutputs([fresh]);
    writeNewReport(fresh, "new");
    assert.throws(() => writeNewReport(fresh, "replacement"), /EEXIST/);
    assert.equal(readFileSync(original, "utf8"), "original");
    const modern = join(dir, "modern.json");
    writeFileSync(modern, JSON.stringify({ schema: 2, samples: [{ protocol: 3 }] }));
    const legacy = spawnSync(
      process.execPath,
      [resolve("benchmarks/startup/account-report.mjs"), modern, join(dir, "legacy")],
      { encoding: "utf8" },
    );
    assert.notEqual(legacy.status, 0);
    assert.match(legacy.stderr, /Legacy reports accept schema-1/);
    assert.equal(readFileSync(fresh, "utf8"), "new");
    const child = spawnSync(process.execPath, [resolve("benchmarks/startup/run.mjs")], {
      encoding: "utf8",
      env: {
        PATH: process.env.PATH,
        SystemRoot: process.env.SystemRoot,
        STARTUP_VERSION: "baseline",
        STARTUP_RUNS: "10",
        STARTUP_OUTPUT: original,
      },
    });
    assert.notEqual(child.status, 0);
    assert.match(child.stderr, /Output already exists/);
    assert.equal(readFileSync(original, "utf8"), "original");
  } finally {
    assert.equal(dirname(resolve(dir)), resolve(tmpdir()));
    assert.match(basename(dir), /^shuttleboard-output-/);
    rmSync(dir, { recursive: true, force: true });
  }
});
