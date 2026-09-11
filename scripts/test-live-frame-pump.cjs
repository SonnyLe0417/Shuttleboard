const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
let callback,
  cancelled = false,
  value = 0,
  now = 1000;
const packets = [];
const video = {
  paused: false,
  readyState: 4,
  currentTime: 0,
  requestVideoFrameCallback(fn) {
    callback = fn;
    return 1;
  },
  cancelVideoFrameCallback() {
    cancelled = true;
  },
};
const context = {
  exports: {},
  Uint8Array,
  ArrayBuffer,
  DataView,
  Math,
  Date: { now: () => now },
  document: {
    createElement: () => ({
      getContext: () => ({
        drawImage() {},
        getImageData() {
          return { data: new Uint8Array(512 * 288 * 4).fill(value) };
        },
      }),
    }),
  },
};
vm.runInNewContext(
  ts.transpileModule(fs.readFileSync("src/lib/live-frame-pump.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText,
  context,
);
const pump = context.exports.startLiveFramePump(video, { sendFrame: (p) => packets.push(p) });
function tick(n) {
  value = n;
  now += 33;
  video.currentTime += 1 / 30;
  callback();
}
tick(1);
tick(2);
assert.equal(packets.length, 1);
for (let n = 3; n <= 10; n++) tick(n);
assert.equal(packets.length, 1, "only one group in flight");
pump.ready();
assert.equal(packets.length, 2);
const bytes = new Uint8Array(packets[1]);
assert.equal(bytes.length, 16 + 3 * 512 * 288);
assert.equal(bytes[16], 8);
assert.equal(bytes[16 + 512 * 288], 9);
assert.equal(bytes[16 + 2 * 512 * 288], 10);
assert.equal(new DataView(packets[1]).getFloat64(8, true), now);
pump.ready();
assert.equal(packets.length, 2, "never resend same group");
pump.stop();
tick(11);
assert.ok(cancelled);
assert.equal(packets.length, 2);
console.log(
  "PASS: latest three frames, binary layout, bounded requests, no duplicate send, cleanup",
);
