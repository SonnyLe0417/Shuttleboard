import { createHash } from "node:crypto";
import type { Plugin } from "vite";
export function offlineScoreboardBuild(): Plugin {
  return {
    name: "offline-scoreboard-shell",
    generateBundle(_options, bundle) {
      if (this.environment.name !== "client") return;
      const chunks = Object.values(bundle).filter((item) => item.type === "chunk");
      const entry = chunks.find((item) => item.isEntry);
      const offline = chunks.find((item) =>
        Object.keys(item.modules).some((id) =>
          id.replaceAll("\\", "/").endsWith("/src/offline-entry.tsx"),
        ),
      );
      const scoreboard = chunks.find(
        (item) =>
          Object.keys(item.modules).some((id) =>
            id.replaceAll("\\", "/").includes("/src/routes/scoreboard.tsx"),
          ) && item !== entry,
      );
      if (!entry || !scoreboard || !offline)
        throw Error("Offline scoreboard build entries missing");
      const assets = new Set<string>();
      const walk = (name: string, dynamic = false) => {
        if (assets.has(name)) return;
        assets.add(name);
        const chunk = bundle[name];
        if (chunk?.type === "chunk") {
          chunk.imports.forEach((file) => walk(file));
          if (dynamic) chunk.dynamicImports.forEach((file) => walk(file, true));
          const metadata = (
            chunk as unknown as {
              viteMetadata?: { importedCss?: Set<string>; importedAssets?: Set<string> };
            }
          ).viteMetadata;
          metadata?.importedCss?.forEach((file) => assets.add(file));
          metadata?.importedAssets?.forEach((file) => assets.add(file));
        }
      };
      walk(entry.fileName);
      walk(offline.fileName);
      walk(scoreboard.fileName, true);
      // Session initialization and root lazy UI must also be available on a cold reopen.
      for (const chunk of chunks)
        if (
          Object.keys(chunk.modules).some((id) =>
            /src\/(integrations\/supabase\/client\.ts|components\/layout\/(ClubNavigation|AppToaster)\.tsx|lib\/match-export\.ts)$/.test(
              id.replaceAll("\\", "/"),
            ),
          )
        )
          walk(chunk.fileName, true);
      const css = Object.values(bundle).filter(
        (item) => item.type === "asset" && item.fileName.endsWith(".css"),
      );
      css.forEach((item) => assets.add(item.fileName));
      const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ShuttleBoard offline scoreboard</title>${css.map((item) => `<link rel="stylesheet" href="/${item.fileName}">`).join("")}</head><body><div id="offline-root"><p role="status">Opening your offline scoreboard…</p></div><script type="module" src="/${entry.fileName}"></script></body></html>`;
      const version = createHash("sha256")
        .update(html + JSON.stringify([...assets].sort()))
        .digest("hex");
      this.emitFile({ type: "asset", fileName: "offline-scoreboard.html", source: html });
      this.emitFile({
        type: "asset",
        fileName: "offline-scoreboard-manifest.json",
        source: JSON.stringify({
          version,
          assets: [
            "/offline-scoreboard.html",
            "/shuttleboard-icon.svg",
            "/favicon.ico",
            ...[...assets].sort().map((file) => "/" + file),
          ],
        }),
      });
    },
  };
}
