import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
import { resolve } from "node:path";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { gunzipSync } from "node:zlib";
const mode = process.env.DASHBOARD_BENCHMARK_VERSION ?? "baseline";
if (mode === "baseline" && !existsSync("dist/performance-baseline/dashboard.tsx")) {
  mkdirSync("dist/performance-baseline", { recursive: true });
  writeFileSync(
    "dist/performance-baseline/dashboard.tsx",
    JSON.parse(gunzipSync(readFileSync("docs/performance/dashboard-baseline-source.json.gz")))
      .dashboard,
  );
}
const source = resolve(
  mode === "baseline"
    ? "dist/performance-baseline/dashboard.tsx"
    : "src/routes/_authenticated/dashboard.tsx",
);
const shim = resolve("benchmarks/dashboard/client.ts");
export default defineConfig({
  plugins: [
    {
      name: "benchmark-export",
      transform(code, id) {
        if (id.replaceAll("\\", "/") === source.replaceAll("\\", "/"))
          return code.replace("function DashboardPage()", "export function DashboardPage()");
      },
    },
    react(),
    tailwind(),
  ],
  resolve: {
    alias: [
      { find: "benchmark-dashboard", replacement: source },
      { find: /^@tanstack\/react-start$/, replacement: shim },
      { find: /^(?:@\/lib\/|\.\/)(dashboard|matches|progress)\.functions$/, replacement: shim },
      { find: "@", replacement: resolve("src") },
    ],
  },
  publicDir: false,
  build: {
    outDir: resolve(`dist/dashboard-benchmark/${mode}`),
    emptyOutDir: true,
    rolldownOptions: { input: resolve("benchmarks/dashboard/index.html") },
  },
});
