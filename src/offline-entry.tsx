// Generic client-only shell: no serialized account, session, or server response.
import { createRoot } from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { getRouter } from "./router";
import { startInstance } from "./start";
export async function mountOfflineScoreboard() {
  // The CSR shell skips SSR hydration, but still needs the same function
  // middleware (including token attachment) as the normal Start client.
  const options = await startInstance.getOptions();
  const startWindow = window as unknown as { __TSS_START_OPTIONS__: typeof options };
  startWindow.__TSS_START_OPTIONS__ = {
    ...options,
    serializationAdapters: options.serializationAdapters ?? [],
  };
  const router = getRouter();
  createRoot(document.getElementById("offline-root")!).render(<RouterProvider router={router} />);
}
