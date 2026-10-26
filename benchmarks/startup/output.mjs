import { existsSync, writeFileSync } from "node:fs";

export function assertNewOutputs(paths) {
  if (new Set(paths).size !== paths.length) throw Error("Output paths must be distinct.");
  for (const path of paths)
    if (existsSync(path)) throw Error(`Output already exists; choose a new filename: ${path}`);
}

export function writeNewReport(path, contents) {
  writeFileSync(path, contents, { flag: "wx" });
}
