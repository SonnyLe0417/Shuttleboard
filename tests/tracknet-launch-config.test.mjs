import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getTrackNetLaunchConfig } from "../scripts/tracknet-launch-config.mjs";

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("unset engine preserves all current engine defaults", () => {
  const config = getTrackNetLaunchConfig(appDir, {});
  assert.equal(config.engine, "current");
  assert.equal(config.serviceModule, "tracknet_live:app");
  assert.equal(
    config.tracknetDir,
    resolve(appDir, "..", "TrackNet-Badminton-Tracking-tensorflow2-main"),
  );
  assert.equal(config.pythonPath, resolve(config.tracknetDir, ".venv311/Scripts/python.exe"));
  assert.deepEqual(config.env, {
    TRACKNET_ENGINE: "current",
    TRACKNET_DIR: config.tracknetDir,
    TRACKNET_BACKEND: "openvino",
    TRACKNET_FRAME_STRIDE: "4",
  });
  assert.deepEqual(config, getTrackNetLaunchConfig(appDir, { TRACKNET_ENGINE: "current" }));
});

test("v3 selects its service and independent runtime paths", () => {
  const config = getTrackNetLaunchConfig(appDir, { TRACKNET_ENGINE: "v3" });
  assert.equal(config.serviceModule, "tracknet_v3_service:app");
  assert.equal(config.tracknetDir, resolve(appDir, ".tracknet-v3/repo"));
  assert.equal(config.pythonPath, resolve(appDir, ".tracknet-v3/.venv/Scripts/python.exe"));
  assert.deepEqual(config.env, {
    TRACKNET_ENGINE: "v3",
    TRACKNET_V3_DIR: config.tracknetDir,
    TRACKNET_BACKEND: "openvino",
    TRACKNET_FRAME_STRIDE: "1",
  });
});

for (const engine of ["current", "v3"]) {
  test(`${engine} honors Python, backend, and repository overrides with spaces`, () => {
    const directoryVariable = engine === "v3" ? "TRACKNET_V3_DIR" : "TRACKNET_DIR";
    const config = getTrackNetLaunchConfig(appDir, {
      TRACKNET_ENGINE: engine,
      [directoryVariable]: "custom model/repo",
      TRACKNET_PYTHON: "custom python/python.exe",
      TRACKNET_BACKEND: "custom-backend",
    });
    assert.equal(config.tracknetDir, resolve("custom model/repo"));
    assert.equal(config.env[directoryVariable], config.tracknetDir);
    assert.equal(config.pythonPath, resolve("custom python/python.exe"));
    assert.equal(config.env.TRACKNET_BACKEND, "custom-backend");
    assert.match(config.directoryHint, new RegExp(directoryVariable));
    assert.match(config.pythonHint, /TRACKNET_PYTHON/);
  });
}

test("repository overrides affect only their selected engine", () => {
  assert.deepEqual(
    getTrackNetLaunchConfig(appDir, { TRACKNET_V3_DIR: "unrelated-v3" }),
    getTrackNetLaunchConfig(appDir, {}),
  );
  assert.deepEqual(
    getTrackNetLaunchConfig(appDir, { TRACKNET_ENGINE: "v3", TRACKNET_DIR: "unrelated-current" }),
    getTrackNetLaunchConfig(appDir, { TRACKNET_ENGINE: "v3" }),
  );
});

test("custom v3 repository does not relocate its sibling Python environment", () => {
  const config = getTrackNetLaunchConfig(appDir, {
    TRACKNET_ENGINE: "v3",
    TRACKNET_V3_DIR: "elsewhere/repo",
  });
  assert.equal(config.pythonPath, resolve(appDir, ".tracknet-v3/.venv/Scripts/python.exe"));
  const current = getTrackNetLaunchConfig(appDir, { TRACKNET_DIR: "elsewhere/current" });
  assert.equal(current.pythonPath, resolve("elsewhere/current/.venv311/Scripts/python.exe"));
});

test("invalid engine values fail instead of silently selecting an engine", () => {
  for (const engine of ["", "V3", "unknown"]) {
    assert.throws(
      () => getTrackNetLaunchConfig(appDir, { TRACKNET_ENGINE: engine }),
      /Invalid TRACKNET_ENGINE.*Choose current or v3/,
    );
  }
});

test("launcher rejects an invalid engine before starting either child", () => {
  const result = spawnSync(process.execPath, [resolve(appDir, "scripts/start-shuttleboard.mjs")], {
    env: { ...process.env, TRACKNET_ENGINE: "invalid-engine" },
    encoding: "utf8",
    windowsHide: true,
    timeout: 10_000,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Invalid TRACKNET_ENGINE "invalid-engine"/);
  assert.equal(result.stdout, "");
});
