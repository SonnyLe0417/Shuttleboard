import type { Plugin } from "vite";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

/** Resolve hashed SDK asset URLs after the client build, for server-rendered session-dependent pages. */
export function startupPreloads(build: boolean): Plugin {
  const virtualId = "virtual:startup-preloads";
  const manifest = resolve(".tanstack/startup-preloads.json");
  return {
    name: "session-dependent-module-preloads",
    resolveId(id) {
      if (id === virtualId) return "\0" + virtualId;
    },
    load(id) {
      if (id !== "\0" + virtualId) return;
      const paths =
        build && this.environment.name !== "client"
          ? JSON.parse(readFileSync(manifest, "utf8"))
          : [];
      return `export const sessionPreloads = ${JSON.stringify(paths)};`;
    },
    generateBundle(_options, bundle) {
      if (this.environment.name !== "client") return;
      const client = Object.values(bundle).find(
        (chunk) =>
          chunk.type === "chunk" &&
          Object.keys(chunk.modules).some((id) =>
            id.replaceAll("\\", "/").endsWith("/src/integrations/supabase/client.ts"),
          ),
      );
      if (!client || client.type !== "chunk")
        throw Error("Session client asset missing from build");
      const visited = new Set<string>();
      const walk = (file: string) => {
        if (visited.has(file)) return;
        visited.add(file);
        const chunk = bundle[file];
        if (chunk?.type === "chunk") chunk.imports.forEach(walk);
      };
      walk(client.fileName);
      mkdirSync(resolve(".tanstack"), { recursive: true });
      writeFileSync(
        manifest,
        JSON.stringify(
          [...visited].filter((file) => file.endsWith(".js")).map((file) => "/" + file),
        ),
      );
    },
  };
}
