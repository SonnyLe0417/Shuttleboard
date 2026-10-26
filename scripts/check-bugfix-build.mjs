// Read-only production smoke checks. No account session, database or paid network calls.
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
for (const name of await readdir(".output/public/assets")) {
  if (!name.endsWith(".js")) continue;
  const source = await readFile(join(".output/public/assets", name), "utf8");
  for (const forbidden of [
    "Two voice commands",
    "Synthetic collector check",
    "__STARTUP_MEASURE__",
    "reserve_ai_vision",
    "release_ai_vision",
    "get_notification_config",
    "SUPABASE_SERVICE_ROLE_KEY",
    "offlineFixture",
    "synthetic-signature",
  ])
    assert.ok(!source.includes(forbidden), `${forbidden} leaked into ${name}`);
}
console.log(
  "PASS production client excludes test fixtures, collector and privileged server operations",
);
// Never inherit real service credentials for these smoke requests.
for (const key of Object.keys(process.env))
  if (/SUPABASE|OPENAI|VAPID/.test(key)) delete process.env[key];
const worker = (await import(pathToFileURL(resolve(".output/server/index.mjs")).href)).default;
const priorFetch = globalThis.fetch;
globalThis.fetch = async () => {
  throw Error("Outbound network prohibited during route smoke");
};
try {
  for (const path of ["/", "/rules", "/auth", "/dashboard", "/social", "/ai", "/video"]) {
    const response = await worker.fetch(
      new Request(`http://localhost${path}`),
      { ASSETS: { fetch: async () => new Response("not found", { status: 404 }) } },
      { waitUntil() {} },
    );
    const html = await response.text();
    assert.ok(response.status >= 200 && response.status < 400, `${path}: ${response.status}`);
    assert.ok(html.length > 0 || response.headers.has("location"), `${path} empty response`);
    console.log(`PASS route ${path} (${response.status})`);
  }
} finally {
  globalThis.fetch = priorFetch;
}
