// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import type { ConfigEnv } from "vite";
import { startupPreloads } from "./scripts/startup-preloads";
import { offlineScoreboardBuild } from "./scripts/offline-scoreboard-build";

const createConfig = defineConfig({
  vite: {
    resolve: { tsconfigPaths: true },
    server: {
      watch: {
        // The local Python environment, models and analysis outputs are not frontend inputs.
        // Watching these trees on Windows can starve SSR module loading.
        ignored: [
          "**/.tracknet-v3/**",
          "**/.output/**",
          "**/dist/**",
          "**/.wrangler/**",
          "**/.pytest_cache/**",
          "**/__pycache__/**",
        ],
      },
    },
    environments: {
      client: {
        build: {
          rolldownOptions: {
            output: {
              codeSplitting: {
                groups: [
                  {
                    // Group the small router primitives shared by both startup routes.
                    name: "startup-router",
                    test: /node_modules[\\/]@tanstack[\\/](?:(?:react-store|store)[\\/]|react-router[\\/]dist[\\/]esm[\\/](?:link|useRouter|useMatch|matchContext|useRouterState)\.js$|router-core[\\/]dist[\\/]esm[\\/]redirect\.js$)/,
                    includeDependenciesRecursively: true,
                    priority: 15,
                  },
                  {
                    // These icons are already needed by the public or dashboard startup path.
                    // Keep other feature icons deferred rather than loading the entire icon set.
                    name: "startup-icons",
                    test: /node_modules[\\/]lucide-react[\\/]dist[\\/]esm[\\/]icons[\\/](arrow-right|arrow-up-right|calendar-days|check|chevron-down|chevron-right|clock-3|flame|gauge|goal|history|loader-circle|menu|play|plus|sparkles|swords|trophy|undo-2|users|video|wand-sparkles|x)\.js$/,
                    includeDependenciesRecursively: false,
                    priority: 10,
                  },
                  {
                    name: "supabase-client",
                    test: /node_modules[\\/]@supabase[\\/]/,
                    // Keep Vite's shared preload helper out of this deferred SDK chunk.
                    includeDependenciesRecursively: false,
                    priority: 30,
                  },
                  {
                    name: "react-runtime",
                    test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/,
                    priority: 20,
                  },
                ],
              },
            },
          },
        },
      },
    },
  },
  tanstackStart: {
    client: { entry: "client" },
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
});

export default async (env: ConfigEnv) => {
  const config = await createConfig(env);
  // Vite 8 resolves tsconfig paths natively. Keep Lovable's remaining plugins intact.
  config.plugins = (await Promise.all(config.plugins ?? [])).filter(
    (plugin) =>
      !(
        plugin &&
        typeof plugin === "object" &&
        "name" in plugin &&
        plugin.name === "vite-tsconfig-paths"
      ),
  );
  config.plugins.push(startupPreloads(env.command === "build"));
  if (env.command === "build") config.plugins.push(offlineScoreboardBuild());
  return config;
};
