import { readFileSync, existsSync } from "node:fs";
import { parseEnv } from "node:util";
import { spawnSync } from "node:child_process";

// User-approved existing credentials go directly to encrypted hosting storage.
// Values never appear in arguments, generated files, logs, or browser code.
const envFile = ".env";
if (!existsSync(envFile)) throw Error("Configure the ignored .env file before deployment.");
const values = parseEnv(readFileSync(envFile, "utf8"));
const required = ["SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SERVICE_ROLE_KEY"];
for (const key of required)
  if (!values[key]?.trim()) throw Error(`Missing server configuration: ${key}`);
if (values.VITE_SUPABASE_URL !== values.SUPABASE_URL)
  throw Error("Client and server Supabase URLs must match.");
const allowed = new Set([
  ...required,
  "SUPABASE_PROJECT_ID",
  "VITE_SUPABASE_PROJECT_ID",
  "VITE_SUPABASE_URL",
  "VITE_SUPABASE_PUBLISHABLE_KEY",
  "OPENAI_API_KEY",
  "AI_VISION_USER_MINUTE_LIMIT",
  "AI_VISION_USER_DAY_LIMIT",
  "AI_VISION_GLOBAL_DAY_LIMIT",
]);
if (Object.keys(values).some((key) => !allowed.has(key)))
  throw Error("Unexpected .env keys: review configuration before sending it to hosting.");
if (!existsSync(".output/server/wrangler.json")) throw Error("Run npm run build first.");
const dryRun = process.argv.includes("--dry-run");
console.log(
  dryRun
    ? "Checking the Cloudflare build without uploading."
    : "Deploying with approved existing configuration as encrypted server secrets.",
);
const args = [
  "exec",
  "--yes",
  "--package",
  "wrangler@4.152.0",
  "--",
  "wrangler",
  "deploy",
  "--config",
  ".output/server/wrangler.json",
  "--name",
  "shuttleboard",
  "--secrets-file",
  envFile,
  "--keep-vars",
  "--strict",
  ...(dryRun ? ["--dry-run"] : []),
];
const result = spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", args, {
  stdio: "inherit",
  shell: process.platform === "win32",
  env: { ...process.env, WRANGLER_LOG: "log" },
});
if (result.error) throw Error("Could not start the pinned deployment CLI.");
process.exitCode = result.status ?? 1;
