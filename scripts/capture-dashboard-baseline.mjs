import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { dashboardBundleSize } from "./dashboard-bundle-size.mjs";
const files = execFileSync("git", ["ls-files", "-c", "-o", "--exclude-standard", "-z"])
  .toString()
  .split("\0")
  .filter(Boolean)
  .sort();
const hash = createHash("sha256");
for (const file of files) {
  hash.update(file);
  try {
    hash.update(readFileSync(file));
  } catch {
    hash.update("deleted");
  }
}
const sources = {
  dashboard: readFileSync("src/routes/_authenticated/dashboard.tsx", "utf8"),
  functions: readFileSync("src/lib/dashboard.functions.ts", "utf8"),
};
mkdirSync("docs/performance", { recursive: true });
mkdirSync("dist/performance-baseline", { recursive: true });
writeFileSync("dist/performance-baseline/dashboard.tsx", sources.dashboard);
writeFileSync(
  "docs/performance/dashboard-baseline-source.json.gz",
  gzipSync(JSON.stringify(sources)),
);
writeFileSync(
  "docs/performance/dashboard-source-baseline.json",
  JSON.stringify(
    {
      capturedAt: new Date().toISOString(),
      revision: execFileSync("git", ["rev-parse", "HEAD"]).toString().trim(),
      workingTreeSha256: hash.digest("hex"),
      contract: sources.dashboard.includes("listMyMatches") ? "legacy" : "split",
      ...dashboardBundleSize(),
    },
    null,
    2,
  ) + "\n",
);
console.log(
  "Dashboard source snapshot and production entry size captured. Existing baseline replaced.",
);
