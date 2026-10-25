import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { allowedControl, instrumentHtml } from "../benchmarks/startup/measure-server.mjs";
test("local measurement control rejects cross-origin and unknown hosts", () => {
  assert.equal(
    allowedControl(
      { method: "POST", headers: { host: "localhost:8080", origin: "http://localhost:8080" } },
      8080,
    ),
    true,
  );
  for (const origin of [
    undefined,
    "https://example.com",
    "http://localhost:8081",
    "http://127.0.0.1:8080",
  ])
    assert.equal(
      allowedControl({ method: "POST", headers: { host: "localhost:8080", origin } }, 8080),
      false,
    );
});
test("preview injection precedes app scripts and never changes saved input", async () => {
  const original = Buffer.from(
    '<html><head><script src="/app.js"></script></head><body></body></html>',
  );
  const injected = await instrumentHtml(original, "baseline", "fixed");
  assert.ok(injected.indexOf('data-build="baseline"') < injected.indexOf("/app.js"));
  assert.equal(original.includes("data-build"), false);
});
test("measurement keeps interrupted records and excludes URLs and account content", async () => {
  const source = await readFile(
    new URL("../benchmarks/startup/measure-client.js", import.meta.url),
    "utf8",
  );
  const events = {},
    storage = new Map();
  let frame;
  const context = {
    innerWidth: 1440,
    innerHeight: 900,
    document: {
      currentScript: { dataset: { build: "baseline", fingerprint: "fixed" } },
      visibilityState: "visible",
      addEventListener: (n, f) => (events[n] = f),
      querySelector: () => null,
    },
    location: { pathname: "/dashboard" },
    sessionStorage: { getItem: (k) => storage.get(k), setItem: (k, v) => storage.set(k, v) },
    crypto: { randomUUID: () => "random-sample" },
    performance: {
      now: () => 10,
      setResourceTimingBufferSize: () => {},
      getEntriesByType: () => [],
    },
    addEventListener: (n, f) => (events[n] = f),
    requestAnimationFrame: (f) => ((frame = f), 1),
    cancelAnimationFrame: () => {},
    setTimeout: () => 1,
    clearTimeout: () => {},
  };
  runInNewContext(source, context);
  assert.equal(typeof frame, "function");
  events.pagehide();
  const data = JSON.parse([...storage.values()][0]).samples[0];
  assert.equal(data.classification, "interrupted");
  assert.equal(data.readyMs, null);
  assert.equal(data.summaryMs, null);
  assert.equal(data.document, null);
  assert.equal(data.exposedTransferBytes, 0);
  assert.equal(JSON.stringify(data).includes("/dashboard"), false);
  context.document.visibilityState = "hidden";
  events.visibilitychange();
  assert.equal(JSON.parse([...storage.values()][0]).samples[0].backgrounded, false);
});

test("marker timing, failures, missing bytes and the session bound remain independent", async () => {
  const source = await readFile(
    new URL("../benchmarks/startup/measure-client.js", import.meta.url),
    "utf8",
  );
  const key = "shuttleboard.startup-measure.v1";
  const storage = new Map([
    [
      key,
      JSON.stringify({ samples: Array.from({ length: 120 }, (_, id) => ({ id: `old-${id}` })) }),
    ],
  ]);
  const events = {};
  let frame,
    complete,
    now = 10,
    ready = false;
  const fakeWindow = {};
  const context = {
    innerWidth: 390,
    innerHeight: 900,
    window: fakeWindow,
    document: {
      currentScript: { dataset: { build: "optimized", fingerprint: "fixed" } },
      visibilityState: "visible",
      addEventListener: (n, f) => (events[n] = f),
      querySelector: () => (ready ? {} : null),
    },
    location: { pathname: "/dashboard" },
    sessionStorage: { getItem: (k) => storage.get(k), setItem: (k, v) => storage.set(k, v) },
    crypto: { randomUUID: () => "current" },
    performance: {
      now: () => now,
      setResourceTimingBufferSize: () => {},
      getEntriesByType: (type) =>
        type === "resource"
          ? [
              {
                name: "https://private.example/content?secret=never-export",
                startTime: 5,
                duration: 22,
                transferSize: 0,
              },
            ]
          : [],
    },
    addEventListener: (n, f) => (events[n] = f),
    requestAnimationFrame: (f) => ((frame = f), 1),
    cancelAnimationFrame: () => {},
    setTimeout: (f) => ((complete = f), 1),
    clearTimeout: () => {},
  };
  runInNewContext(source, context);
  now = 40;
  frame();
  assert.equal(JSON.parse(storage.get(key)).samples.at(-1).readyMs, null);
  ready = true;
  now = 75;
  frame();
  events.error({ target: fakeWindow });
  complete();
  const result = JSON.parse(storage.get(key));
  assert.equal(result.samples.length, 120);
  assert.equal(result.samples.at(-1).readyMs, 75);
  assert.equal(result.samples.at(-1).summaryMs, 75);
  assert.equal(result.samples.at(-1).failures, 1);
  assert.equal(result.samples.at(-1).zeroOrUnavailableTransferEntries, 1);
  assert.equal(result.samples.at(-1).exposedTransferBytes, 0);
  assert.equal(storage.get(key).includes("private.example"), false);
  assert.equal(storage.get(key).includes("never-export"), false);
});

for (const reason of ["backgrounded", "viewport-changed"]) {
  test(`${reason} interrupts the sample and pauses the batch without advancing it`, async () => {
    const source = await readFile(
      new URL("../benchmarks/startup/measure-client.js", import.meta.url),
      "utf8",
    );
    let saved = JSON.stringify({
      protocol: 3,
      samples: [],
      viewport: { width: 1440, height: 900 },
      run: { kind: "reload", index: 3 },
    });
    const events = {};
    let reloads = 0;
    const context = {
      innerWidth: 1440,
      innerHeight: 900,
      document: {
        currentScript: { dataset: { build: "baseline", fingerprint: "fixed" } },
        visibilityState: "visible",
        addEventListener: (n, f) => (events[n] = f),
        querySelector: () => null,
      },
      location: { pathname: "/dashboard", reload: () => reloads++ },
      sessionStorage: { getItem: () => saved, setItem: (_k, v) => (saved = v) },
      crypto: { randomUUID: () => "interrupted-sample" },
      performance: {
        now: () => 10,
        setResourceTimingBufferSize: () => {},
        getEntriesByType: () => [],
      },
      addEventListener: (n, f) => (events[n] = f),
      requestAnimationFrame: () => 1,
      cancelAnimationFrame: () => {},
      setTimeout: () => 1,
      clearTimeout: () => {},
    };
    runInNewContext(source, context);
    if (reason === "backgrounded") {
      context.document.visibilityState = "hidden";
      events.visibilitychange();
    } else {
      context.innerWidth = 390;
      events.resize();
    }
    const result = JSON.parse(saved);
    assert.equal(result.samples[0].classification, reason);
    assert.equal(result.samples[0].readyMs, null);
    assert.equal(result.run.index, 3);
    assert.equal(result.run.paused, true);
    assert.equal(reloads, 0);
    context.document.visibilityState = "visible";
    events.visibilitychange();
    assert.equal(JSON.parse(saved).run.paused, true);
  });
}
