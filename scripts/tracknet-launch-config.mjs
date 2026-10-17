import { resolve } from "node:path";

// Keep selection separate from process startup so it can be checked without a model runtime.
export function getTrackNetLaunchConfig(appDir, env = process.env) {
  const engine = env.TRACKNET_ENGINE ?? "current";
  if (engine !== "current" && engine !== "v3") {
    throw new Error(`Invalid TRACKNET_ENGINE "${engine}". Choose current or v3.`);
  }

  const isV3 = engine === "v3";
  const directoryVariable = isV3 ? "TRACKNET_V3_DIR" : "TRACKNET_DIR";
  const tracknetDir = resolve(
    env[directoryVariable] ??
      (isV3
        ? resolve(appDir, ".tracknet-v3", "repo")
        : resolve(appDir, "..", "TrackNet-Badminton-Tracking-tensorflow2-main")),
  );
  const defaultPython = isV3
    ? resolve(appDir, ".tracknet-v3", ".venv", "Scripts", "python.exe")
    : resolve(tracknetDir, ".venv311", "Scripts", "python.exe");

  return {
    engine,
    tracknetDir,
    pythonPath: resolve(env.TRACKNET_PYTHON ?? defaultPython),
    serviceModule: isV3 ? "tracknet_v3_service:app" : "tracknet_live:app",
    directoryHint: `Set ${directoryVariable} to the ${isV3 ? "TrackNet V3 repository" : "folder containing tracknet_service.py"} to override it.`,
    pythonHint: `Create the ${isV3 ? ".tracknet-v3/.venv" : ".venv311"} environment or set TRACKNET_PYTHON to its Python executable.`,
    env: {
      TRACKNET_ENGINE: engine,
      [directoryVariable]: tracknetDir,
      TRACKNET_BACKEND: env.TRACKNET_BACKEND ?? "openvino",
      TRACKNET_FRAME_STRIDE: env.TRACKNET_FRAME_STRIDE ?? (isV3 ? "1" : "4"),
    },
  };
}
