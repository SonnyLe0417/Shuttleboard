// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import type { ConfigEnv } from "vite";

const createConfig = defineConfig({
  vite: {
    resolve: { tsconfigPaths: true },
    environments: {
      client: {
        build: {
          rolldownOptions: {
            output: {
              codeSplitting: {
                groups: [
                  {
                    name: "supabase-client",
                    test: /node_modules[\\/]@supabase[\\/]/,
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
  return config;
};
