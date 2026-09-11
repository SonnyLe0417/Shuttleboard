import type { LiveTrackNetConnection, LiveTrackNetDetection } from "./tracknet-client";

export function openLiveTrackNet(
  url: string,
  onMessage: (message: LiveTrackNetDetection) => void,
  onError?: (error: Event) => void,
  onClose?: () => void,
  options: { signal?: AbortSignal; readyTimeoutMs?: number; frameTimeoutMs?: number } = {},
): Promise<LiveTrackNetConnection> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) return reject(new DOMException("Cancelled", "AbortError"));
    const socket = new WebSocket(url);
    let ready = false;
    let closed = false;
    let awaiting: number | null = null;
    let frameTimer: ReturnType<typeof setTimeout> | undefined;
    const clear = () => {
      clearTimeout(readyTimer);
      clearTimeout(frameTimer);
      options.signal?.removeEventListener("abort", abort);
    };
    const stop = (message?: string, event?: Event) => {
      if (closed) return;
      closed = true;
      clear();
      if (!ready) reject(new Error(message ?? "TrackNet connection cancelled."));
      if (message) onError?.(event ?? new Event("connection-error"));
      socket.close();
    };
    const abort = () => stop();
    const readyTimer = setTimeout(
      () =>
        stop(
          "TrackNet did not become ready. Restart tracking to retry.",
          new Event("ready-timeout"),
        ),
      options.readyTimeoutMs ?? 30_000,
    );
    options.signal?.addEventListener("abort", abort, { once: true });
    socket.onerror = (event) => stop("TrackNet live connection failed.", event);
    socket.onclose = () => {
      if (closed) return;
      closed = true;
      clear();
      if (!ready) reject(new Error("TrackNet closed before it was ready."));
      onClose?.();
    };
    socket.onmessage = (event) => {
      if (closed) return;
      let message: LiveTrackNetDetection;
      try {
        message = JSON.parse(String(event.data));
        if (!message || !["ready", "detection", "error"].includes(message.type)) throw new Error();
        if (message.type === "detection") {
          if (
            typeof message.visible !== "boolean" ||
            typeof message.confidence !== "number" ||
            !Number.isFinite(message.confidence) ||
            message.confidence < 0 ||
            message.confidence > 1
          )
            throw new Error();
          if (
            message.visible &&
            ![message.x, message.y].every(
              (n) => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1,
            )
          )
            throw new Error();
        }
      } catch {
        stop("TrackNet sent an invalid response.", new Event("invalid-message"));
        return;
      }
      if (message.type === "error") {
        onMessage(message);
        stop("TrackNet inference failed.");
        return;
      }
      if (message.type === "ready") {
        if (ready) return;
        ready = true;
        clearTimeout(readyTimer);
        onMessage(message);
        resolve({
          socket,
          sendFrame(image, frame, timestamp, courtCorners) {
            if (closed || socket.readyState !== WebSocket.OPEN || awaiting !== null) return;
            awaiting = frame;
            frameTimer = setTimeout(
              () =>
                stop(
                  "TrackNet stopped returning frames. Restart tracking to retry.",
                  new Event("frame-timeout"),
                ),
              options.frameTimeoutMs ?? 15_000,
            );
            try {
              socket.send(
                image instanceof ArrayBuffer
                  ? image
                  : JSON.stringify({ type: "frame", image, frame, timestamp, courtCorners }),
              );
            } catch {
              stop("TrackNet couldn't send a frame.");
            }
          },
          close: () => stop(),
        });
      } else if (ready && awaiting !== null && message.frame === awaiting) {
        awaiting = null;
        clearTimeout(frameTimer);
        onMessage(message);
      }
    };
  });
}
