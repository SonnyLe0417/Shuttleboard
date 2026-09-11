import type { LiveTrackNetConnection } from "./tracknet-client";

// Capture continues during inference. Only the latest three camera frames survive.
export function startLiveFramePump(
  video: HTMLVideoElement,
  connection: LiveTrackNetConnection,
  onSkipped: (count: number) => void = () => {},
) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 288;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Camera capture is unavailable");
  const frames: Uint8Array[] = [];
  let stopped = false;
  let busy = false;
  let id = 0;
  let sent = 0;
  let timestamp = 0;
  let callback = 0;
  let lastTime = -1;
  const native = typeof video.requestVideoFrameCallback === "function";
  const flush = () => {
    if (stopped || busy || frames.length !== 3 || id === sent || Date.now() - timestamp > 150)
      return;
    const packet = new ArrayBuffer(16 + 3 * 512 * 288);
    const header = new DataView(packet);
    header.setFloat64(0, id, true);
    header.setFloat64(8, timestamp, true);
    frames.forEach((frame, i) =>
      new Uint8Array(packet, 16 + i * frame.length, frame.length).set(frame),
    );
    busy = true;
    if (sent > 0 && id > sent + 1) onSkipped(id - sent - 1);
    sent = id;
    connection.sendFrame(packet, id, timestamp);
  };
  const capture = () => {
    if (stopped) return;
    if (!video.paused && video.readyState >= 2 && video.currentTime !== lastTime) {
      const now = Date.now();
      if (now - timestamp > 150) frames.length = 0;
      lastTime = video.currentTime;
      timestamp = now;
      ctx.drawImage(video, 0, 0, 512, 288);
      const pixels = ctx.getImageData(0, 0, 512, 288).data;
      const gray = new Uint8Array(512 * 288);
      for (let i = 0; i < gray.length; i++) {
        const p = i * 4;
        gray[i] = Math.round(pixels[p] * 0.299 + pixels[p + 1] * 0.587 + pixels[p + 2] * 0.114);
      }
      frames.push(gray);
      if (frames.length > 3) frames.shift();
      id++;
      flush();
    }
    callback = native ? video.requestVideoFrameCallback(capture) : requestAnimationFrame(capture);
  };
  capture();
  return {
    ready() {
      busy = false;
      flush();
    },
    stop() {
      stopped = true;
      if (native) video.cancelVideoFrameCallback(callback);
      else cancelAnimationFrame(callback);
      frames.length = 0;
    },
  };
}
