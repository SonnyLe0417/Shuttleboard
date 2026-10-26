import { StrictMode, startTransition } from "react";
import { hydrateRoot } from "react-dom/client";
import { StartClient } from "@tanstack/react-start/client";
// Keep one framework entry. Only the deliberately generic static shell uses CSR.
if (document.getElementById("offline-root"))
  void import("./offline-entry").then((module) => module.mountOfflineScoreboard());
else
  startTransition(() => {
    hydrateRoot(
      document,
      <StrictMode>
        <StartClient />
      </StrictMode>,
    );
  });
