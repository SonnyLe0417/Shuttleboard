# Development server timeout recovery

The reported `vite:invoke` / `fetchModule` timeout occurred while loading TanStack
server modules. CPU profiling of an isolated reproduction showed most samples in
filesystem watcher setup and directory matching. The project contains a large
local TrackNet Python environment and generated analysis files below its root.

`vite.config.ts` now excludes `.tracknet-v3`, `.output`, `dist`, `.wrangler`,
`.pytest_cache`, and Python `__pycache__` trees from frontend watching. Frontend
source files remain watched. No TrackNet inference, model, account, API or database
settings changed. The Vite version experiment was reverted; both package manifests
were verified byte-for-byte identical to their pre-diagnosis copies.

## Verification

- A clean-cache reproduction stalled before the fix; with watcher exclusions,
  the first HTML request completed and subsequent main routes returned HTTP 200.
- `node scripts/check-dev-server.mjs` passed: `/`, `/auth`, and `/dashboard`
  returned app shells; zero TrackNet directories were watched; creating and
  changing a temporary frontend file emitted the expected watcher events.
- The smoke check's first HTML request took 8,439 ms; `/auth` took 312 ms and
  `/dashboard` 77 ms. These are single development-server smoke observations,
  not production performance benchmarks or authenticated data-readiness timings.
- The normal server on port 5173 returned HTTP 200. Chrome displayed the signed-in
  dashboard, including the existing resumable match. No match controls were used.
- Formatting, targeted lint, typecheck, and production build passed.

Run the smoke check with port 5182 free. It starts and closes its own server and
removes its temporary source file. It does not change account data or use saved
credentials. The production real-account performance matrix remains separate.
