import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, cpSync } from "node:fs";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { dashboardBundleSize } from "../../scripts/dashboard-bundle-size.mjs";
import { assertNewOutputs } from "./output.mjs";
const report = "docs/performance/startup-source-baseline.json";
assertNewOutputs([
  report,
  "dist/startup/baseline",
  "docs/performance/startup-baseline-source.json.gz",
  "docs/performance/startup-baseline-package-lock.json",
]);
const files = execFileSync("git", ["ls-files", "-c", "-o", "--exclude-standard", "-z"])
  .toString()
  .split("\0")
  .filter(Boolean)
  .sort();
const hash = createHash("sha256"),
  sources = {};
for (const file of files) {
  hash.update(file);
  try {
    const value = readFileSync(file);
    hash.update(value);
    if (file.startsWith("src/") || file === "vite.config.ts") sources[file] = value.toString();
  } catch {
    hash.update("deleted");
  }
}
mkdirSync("dist/startup/baseline", { recursive: true });
cpSync(".output", "dist/startup/baseline/production", { recursive: true });
writeFileSync(
  "docs/performance/startup-baseline-source.json.gz",
  gzipSync(JSON.stringify(sources)),
);
cpSync("package-lock.json", "docs/performance/startup-baseline-package-lock.json");
writeFileSync(
  report,
  JSON.stringify(
    {
      capturedAt: new Date().toISOString(),
      revision: execFileSync("git", ["rev-parse", "HEAD"]).toString().trim(),
      workingTreeSha256: hash.digest("hex"),
      lockfileSha256: createHash("sha256").update(readFileSync("package-lock.json")).digest("hex"),
      ...dashboardBundleSize(),
    },
    null,
    2,
  ) + "\n",
);
console.log("Startup production baseline preserved.");
