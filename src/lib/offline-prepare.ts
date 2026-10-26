export async function prepareOfflineAssets() {
  if (!navigator.serviceWorker || !navigator.locks)
    throw Error(
      "This browser cannot safely prepare offline scoring. Use a current browser over HTTPS.",
    );
  const registration = await navigator.serviceWorker.register("/sw.js");
  await registration.update();
  const installing = registration.installing;
  if (installing && !["installed", "activated"].includes(installing.state))
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(Error("Offline worker update timed out. Try again online.")),
        30000,
      );
      installing.addEventListener("statechange", () => {
        if (installing.state === "installed" || installing.state === "activated") {
          clearTimeout(timeout);
          resolve();
        } else if (installing.state === "redundant") {
          clearTimeout(timeout);
          reject(Error("Offline worker could not install."));
        }
      });
    });
  // Taking over requests does not reload the page or discard the active match.
  const worker = registration.waiting ?? registration.active;
  if (!worker) throw Error("Offline worker is not available yet. Try again.");
  return new Promise<void>((resolve, reject) => {
    const channel = new MessageChannel(),
      timeout = setTimeout(() => {
        channel.port1.close();
        reject(Error("Offline preparation timed out. Your previous offline copy was retained."));
      }, 60000);
    channel.port1.onmessage = (event) => {
      clearTimeout(timeout);
      channel.port1.close();
      if (event.data?.ok === true) resolve();
      else reject(Error(event.data?.error ?? "Offline preparation failed."));
    };
    worker.postMessage({ type: "PREPARE_SCOREBOARD" }, [channel.port2]);
  });
}
export async function offlineAssetsReady() {
  if (typeof caches === "undefined") return false;
  try {
    const meta = await caches.open("shuttleboard-scoreboard-meta"),
      response = await meta.match("/offline-active");
    if (!response) return false;
    const active = await response.json();
    if (!Array.isArray(active.assets) || !active.assets.includes("/offline-scoreboard.html"))
      return false;
    const cache = await caches.open(active.name);
    return (await Promise.all(active.assets.map((path: string) => cache.match(path)))).every(
      Boolean,
    );
  } catch {
    return false;
  }
}
