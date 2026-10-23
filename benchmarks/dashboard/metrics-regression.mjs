// Synthetic diagnostic-only fixture. Never used for real-account measurements.
import { createServer } from "vite";
import { readFile } from "node:fs/promises";

let revision = 0;
const modulePath = "/__metrics_module.ts";
const server = await createServer({
  configFile: false,
  publicDir: false,
  appType: "custom",
  optimizeDeps: { noDiscovery: true, include: [] },
  server: { host: "127.0.0.1", port: 5183, strictPort: true, watch: null },
  plugins: [
    {
      name: "diagnostic-regression-fixture",
      resolveId(id) {
        return id === modulePath ? modulePath : null;
      },
      async load(id) {
        if (id !== modulePath) return null;
        return (
          (await readFile("src/lib/dashboard-live-metrics.ts", "utf8")) +
          `\n// revision ${revision}\n`
        );
      },
    },
  ],
});
const html = `<!doctype html><html><head><title>Diagnostic regression fixture</title></head><body>
<main id="main-content"><h1>Diagnostic regression fixture</h1><p>Synthetic DOM; no authentication or account data.</p>
<div data-dashboard-ready="true">Fixture primary controls</div><div data-dashboard-summary="pending">Fixture summary</div>
<button id="complete">Complete summary</button><button id="reload">Hot reload diagnostics</button><p id="revision">Updates: 0</p>
<details><summary>More progress and shortcuts</summary><div data-dashboard-details="ready">Fixture progress</div></details></main>
<script type="module">
import { startDashboardLiveMetrics } from '${modulePath}';
startDashboardLiveMetrics(performance.now());
let updates=0;
document.querySelector('#complete').onclick=()=>document.querySelector('[data-dashboard-summary]').dataset.dashboardSummary='ready';
document.querySelector('#reload').onclick=()=>fetch('/__reload',{method:'POST'});
import.meta.hot.accept('${modulePath}',next=>{next.startDashboardLiveMetrics(performance.now());document.querySelector('#revision').textContent='Updates: '+(++updates);});
</script></body></html>`;
server.middlewares.use(async (req, res, next) => {
  try {
    if (req.url === "/__reload" && req.method === "POST") {
      revision++;
      await server.environments.client.reloadModule(
        server.environments.client.moduleGraph.getModuleById(modulePath),
      );
      res.writeHead(204).end();
    } else if (req.url?.startsWith("/dashboard")) {
      res.setHeader("content-type", "text/html");
      res.end(await server.transformIndexHtml("/dashboard", html));
    } else next();
  } catch (error) {
    console.error(error);
    res.writeHead(500).end("Fixture failed");
  }
});
await server.listen();
console.log("Diagnostic regression fixture: http://127.0.0.1:5183/dashboard?dashboardMetrics=1");
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, async () => {
    await server.close();
    process.exit(0);
  });
