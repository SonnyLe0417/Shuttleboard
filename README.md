# ShuttleBoard

Badminton match tracking, scoring, history, social features, and analysis built with TanStack Start, React, and Supabase.

## Where to find things

| Folder             | Purpose                                                         |
| ------------------ | --------------------------------------------------------------- |
| `src/routes`       | Pages, route guards, and API routes                             |
| `src/components`   | Reusable UI and badminton court components                      |
| `src/hooks`        | React hooks for sessions, matches, and device features          |
| `src/lib`          | Business logic, server functions, rules, exports, and utilities |
| `src/integrations` | Supabase and Lovable integration code                           |
| `public`           | Static browser assets and the service worker                    |
| `supabase`         | Database configuration and migrations                           |
| `docs/outputs`     | Generated presentations and inspection artifacts                |

## Common commands

```bash
npm run shuttleboard # Start ShuttleBoard and the local TrackNet service together
npm run dev       # Start the local development server
npm run lint      # Run ESLint
npm run build     # Create a production build
npx tsc --noEmit  # Check TypeScript without emitting files
```

`npm run shuttleboard` starts the React app first, warms the most-used routes,
and then starts the TrackNet FastAPI service in the background. TrackNet's
model is loaded once and kept in memory for the session. Press `Ctrl+C` once to
stop both. By default, it expects the TrackNet repository at
`../TrackNet-Badminton-Tracking-tensorflow2-main` and uses its `.venv311`
environment. Set `TRACKNET_DIR` or `TRACKNET_PYTHON` if your folders differ.

Generated folders such as `.output`, `.tanstack`, `.wrangler`, and `node_modules` are intentionally hidden from the VS Code Explorer through the workspace settings.
