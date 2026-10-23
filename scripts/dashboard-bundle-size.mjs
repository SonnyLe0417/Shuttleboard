import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, dirname } from "node:path";
export function dashboardBundleSize() {
  const root = resolve(".output/public/assets");
  const entry = readdirSync(root).find((file) => /^index-.*\.js$/.test(file));
  const visited = new Set();
  function walk(file) {
    if (visited.has(file)) return;
    visited.add(file);
    const source = readFileSync(file, "utf8");
    // Rolldown output uses ordinary static import declarations; dynamic imports are excluded.
    for (const match of source.matchAll(
      /\bimport\s*(?:\{[^}]*\}|[\w*$,\s]+)?\s*(?:from\s*)?["'](\.\/[^"']+\.js)["']/g,
    ))
      walk(resolve(dirname(file), match[1]));
  }
  walk(resolve(root, entry));
  return {
    entryAsset: entry,
    entryBytes: statSync(resolve(root, entry)).size,
    staticInitialJavascriptBytes: [...visited].reduce((sum, file) => sum + statSync(file).size, 0),
    staticInitialAssetCount: visited.size,
  };
}
