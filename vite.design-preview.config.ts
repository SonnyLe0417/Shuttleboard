import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Independent review entry: never imported into the production router or bundle.
export default defineConfig({
  plugins: [react()],
  cacheDir: "node_modules/.vite-design-preview",
  publicDir: false,
  server: { host: "127.0.0.1", port: 5175, strictPort: true },
  build: {
    outDir: "dist/design-preview",
    rolldownOptions: { input: "design-preview/index.html" },
  },
});
