import test from "node:test";
import assert from "node:assert/strict";
import { isSupportedVideo } from "../src/lib/video-upload.ts";
import { previewFailureMessage, shouldCreateBrowserPreview } from "../src/lib/video-preview.ts";

test("accepts video files", () => {
  assert.equal(isSupportedVideo({ type: "video/mp4" }), true);
  assert.equal(isSupportedVideo({ type: "video/webm" }), true);
});

test("rejects non-video files", () => {
  assert.equal(isSupportedVideo({ type: "image/png" }), false);
  assert.equal(isSupportedVideo({ type: "application/pdf" }), false);
  assert.equal(isSupportedVideo({ type: "" }), false);
});

test("tries preview conversion once when a browser cannot load the video", () => {
  assert.equal(shouldCreateBrowserPreview({ name: "match.mov" }, false), true);
  assert.equal(shouldCreateBrowserPreview({ name: "match.mov" }, true), false);
  assert.equal(shouldCreateBrowserPreview(null, false), false);
});

test("keeps a simple preview error message", () => {
  assert.equal(
    previewFailureMessage("FFmpeg is unavailable."),
    "This video could not be previewed. FFmpeg is unavailable.",
  );
});
