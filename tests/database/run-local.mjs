// Deliberately cannot accept a remote database URL, project ref, or credentials.
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, copyFile, readdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { existsSync } from "node:fs";
import { runDatabaseChecks } from "./verify.mjs";
const exec = promisify(execFile);
const base = resolve("tests/database"),
  runtime = join(base, ".runtime"),
  supabase = join(runtime, "supabase");
let container = "supabase_db_shuttleboard-bugfix-tests";
const docker =
  process.platform === "win32"
    ? "C:/Program Files/Docker/Docker/resources/bin/docker.exe"
    : "docker";
const cli = resolve("node_modules/supabase/dist/supabase.js");
const advisorOutput = process.argv
  .find((arg) => arg.startsWith("--advisors-output="))
  ?.slice("--advisors-output=".length);
if (advisorOutput && existsSync(advisorOutput))
  throw Error("Advisor output already exists; choose a new filename.");
const dockerHost =
  process.platform === "win32"
    ? "npipe:////./pipe/dockerDesktopLinuxEngine"
    : "unix:///var/run/docker.sock";
const safeEnv = Object.fromEntries(
  Object.entries(process.env).filter(([key]) =>
    /^(PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP|HOME|USERPROFILE|APPDATA|LOCALAPPDATA|PROGRAMFILES|PROGRAMFILES\(X86\)|PROGRAMDATA)$/i.test(
      key,
    ),
  ),
);
safeEnv.DOCKER_HOST = dockerHost;
async function command(file, args) {
  return exec(file, args, { env: safeEnv, maxBuffer: 4 * 1024 * 1024 });
}
function sql(query) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(
      docker,
      [
        "exec",
        "-i",
        container,
        "psql",
        "-X",
        "-qAt",
        "-v",
        "ON_ERROR_STOP=1",
        "-U",
        "postgres",
        "-d",
        "postgres",
      ],
      { env: safeEnv, stdio: ["pipe", "pipe", "pipe"] },
    );
    let output = "",
      error = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (error += chunk));
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0
        ? resolvePromise(output.trim())
        : reject(Error(error.trim() || `psql exited ${code}`)),
    );
    child.stdin.on("error", () => {});
    child.stdin.end(query);
  });
}
await mkdir(join(supabase, "migrations"), { recursive: true });
await copyFile(join(base, "local/supabase/config.toml"), join(supabase, "config.toml"));
for (const file of await readdir("supabase/migrations"))
  if (file.endsWith(".sql"))
    await copyFile(join("supabase/migrations", file), join(supabase, "migrations", file));
const config = await readFile(join(supabase, "config.toml"), "utf8");
if (
  !config.includes('project_id = "shuttleboard-bugfix-tests"') ||
  !config.includes("port = 55422")
)
  throw Error("Unexpected isolated test configuration");
if (process.argv.includes("--prepare")) {
  console.log("Prepared isolated migrations/config only. Database checks have NOT run.");
  process.exit(0);
}
if (!existsSync(cli)) throw Error("Install pinned project dependencies first.");
await command(docker, ["info", "--format", "{{.ServerVersion}}"]);
const existing = await command(docker, [
  "ps",
  "-a",
  "--filter",
  "name=shuttleboard-bugfix-tests",
  "--format",
  "{{.Names}}",
]);
const priorContainers = await command(docker, ["ps", "-a", "--format", "{{.ID}}"]);
const priorIds = new Set(priorContainers.stdout.trim().split(/\s+/));
const occupied = await command(docker, ["ps", "--filter", "publish=55422", "--format", "{{.ID}}"]);
if (existing.stdout.trim() || occupied.stdout.trim())
  throw Error(
    "An isolated test stack already exists. Inspect it before starting another run; this runner will not reset it.",
  );
let starting = false;
try {
  starting = true;
  console.log(
    "Starting isolated local Supabase; initial image downloads may take several minutes.",
  );
  await command(process.execPath, [
    cli,
    "start",
    "--workdir",
    runtime,
    "--exclude",
    "studio,imgproxy,edge-runtime,vector,logflare,supavisor",
  ]);
  // CLI releases can generate a local project identifier instead of using
  // config.project_id in container names. Only use a NEW container on our port.
  const running = await command(docker, [
    "ps",
    "--filter",
    "publish=55422",
    "--format",
    "{{.ID}} {{.Names}}",
  ]);
  const candidates = running.stdout.trim().split(/\r?\n/).filter(Boolean);
  const [databaseId, databaseName] = (candidates[0] || "").split(/\s+/);
  if (
    candidates.length !== 1 ||
    priorIds.has(databaseId) ||
    !/^supabase_db_[a-z0-9_-]+$/.test(databaseName || "")
  )
    throw Error(
      "CLI startup did not create a unique new Supabase database on isolated port 55422.",
    );
  container = databaseName;
  console.log("Isolated database started; running real-role and transaction checks.");
  // Historical migrations schedule jobs, but test config has no delivery secrets.
  // Disable all cron jobs before fixtures, before any synthetic configuration is inserted.
  await sql("SELECT cron.unschedule(jobid) FROM cron.job;");
  await runDatabaseChecks(sql);
  console.log(
    "PASS isolated database roles, quota limits/leases/concurrency, invitation transactions and offline ownership/idempotency/rewards",
  );
  if (advisorOutput) {
    const result = await command(process.execPath, [
      cli,
      "db",
      "advisors",
      "--local",
      "--workdir",
      runtime,
      "--type",
      "all",
      "--level",
      "info",
      "--fail-on",
      "none",
      "--output",
      "json",
    ]);
    JSON.parse(result.stdout); // Never label non-JSON CLI output as a valid report.
    await writeFile(advisorOutput, result.stdout, { encoding: "utf8", flag: "wx" });
    console.log(`Local database advisor report saved: ${advisorOutput}`);
  }
} finally {
  if (starting) await command(process.execPath, [cli, "stop", "--workdir", runtime, "--no-backup"]);
}
