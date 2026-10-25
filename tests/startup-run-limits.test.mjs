import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
const source = await readFile(
  new URL("../benchmarks/startup/measure-client.js", import.meta.url),
  "utf8",
);
function harness(initial = {}, ready = true) {
  let saved = JSON.stringify({ protocol: 3, samples: [], ...initial }),
    frame,
    timer,
    now = 1000,
    reloads = 0,
    id = initial.samples?.length ?? 0;
  const buttons = [],
    events = {};
  function element(tag) {
    return {
      tag,
      style: {},
      dataset: {},
      children: [],
      isConnected: false,
      setAttribute() {},
      append(...items) {
        this.children.push(...items);
      },
      remove() {
        this.isConnected = false;
      },
      querySelector(selector) {
        return selector === "textarea"
          ? this.children.find((x) => x.tag === "textarea")
          : this.children[0];
      },
    };
  }
  const context = {
    innerWidth: 1440,
    innerHeight: 900,
    document: {
      body: {
        append(node) {
          node.isConnected = true;
        },
      },
      currentScript: { dataset: { build: "baseline", fingerprint: "fixed" } },
      visibilityState: "visible",
      addEventListener: (name, listener) => (events[name] = listener),
      querySelector: () => (ready ? {} : null),
      createElement(tag) {
        const el = element(tag);
        if (tag === "button") buttons.push(el);
        return el;
      },
    },
    location: { pathname: "/dashboard", reload: () => reloads++ },
    sessionStorage: {
      getItem: () => saved,
      setItem: (_k, v) => (saved = v),
      removeItem: () => (saved = null),
    },
    crypto: { randomUUID: () => `sample-${++id}` },
    Date: { now: () => now },
    performance: { now: () => now, setResourceTimingBufferSize() {}, getEntriesByType: () => [] },
    addEventListener: (name, listener) => (events[name] = listener),
    requestAnimationFrame: (f) => ((frame = f), 1),
    cancelAnimationFrame() {},
    setTimeout: (f) => ((timer = f), 1),
    clearTimeout() {
      timer = undefined;
    },
  };
  runInNewContext(source, context);
  frame();
  timer?.();
  return {
    state: () => JSON.parse(saved),
    click: (name) => buttons.find((b) => b.textContent === name).onclick(),
    advance: (ms) => (now += ms),
    reloads: () => reloads,
    emit: (name) => events[name](),
    context,
    tick: () => timer?.(),
    frame: () => frame(),
    buttons,
  };
}

test("departing document visibility and resize events do not pause the next reload", () => {
  const h = harness({
    viewport: { width: 1440, height: 900 },
    session: { id: "session", navigations: 0, startedAt: 0 },
    run: { id: "batch", kind: "reload", index: 0 },
  });
  assert.equal(h.state().run.index, 1);
  h.emit("pagehide");
  h.context.document.visibilityState = "hidden";
  h.emit("visibilitychange");
  h.context.innerHeight = 800;
  h.emit("resize");
  assert.notEqual(h.state().run.paused, true);
  const next = harness(h.state());
  assert.equal(next.state().samples.at(-1).scheduled, true);
  assert.equal(next.state().samples.at(-1).sampleIndex, 1);
  assert.equal(next.state().run.index, 2);
});

test("hiding a live document still pauses until an explicit resume", () => {
  const h = harness({
    session: { id: "session", navigations: 0, startedAt: 0 },
    run: { id: "batch", kind: "reload", index: 0 },
  });
  h.context.document.visibilityState = "hidden";
  h.emit("visibilitychange");
  assert.equal(h.state().run.paused, true);
  h.emit("pagehide");
  h.context.document.visibilityState = "visible";
  h.emit("visibilitychange");
  assert.equal(h.state().run.paused, true);
});

test("controlled reload ignores outgoing lifecycle events even before pagehide", () => {
  const h = harness({
    viewport: { width: 1440, height: 900 },
    session: { id: "session", navigations: 0, startedAt: 0 },
    run: { id: "batch", kind: "reload", index: 0 },
  });
  h.tick();
  assert.equal(h.reloads(), 1);
  h.context.document.visibilityState = "hidden";
  h.emit("visibilitychange");
  h.context.innerHeight = 800;
  h.emit("resize");
  h.emit("pagehide");
  assert.notEqual(h.state().run.paused, true);
  assert.equal(h.state().samples.at(-1).backgrounded, false);
  assert.equal(harness(h.state()).state().samples.at(-1).scheduled, true);
});
test("cached batches explicitly prepare a fresh document without counting it as a return", () => {
  const h = harness();
  h.click("Measure cached-return");
  assert.equal(h.reloads(), 1);
  assert.equal(h.state().run.preparing, true);
  assert.equal(h.state().run.index, 0);
  const prepared = harness({ ...h.state() });
  assert.equal(prepared.state().samples.at(-1).scheduled, false);
  assert.equal(prepared.state().run.preparing, false);
  assert.equal(prepared.state().run.freshAt, 1000);
});
test("navigation and elapsed-time caps prevent another automatic reload", () => {
  for (const session of [
    { id: "session", navigations: 79, startedAt: 0 },
    { id: "session", navigations: 0, startedAt: -1200000 },
  ]) {
    const h = harness({ session });
    h.click("Measure reload");
    assert.equal(h.reloads(), 0);
    assert.equal(h.state().stopReason, "limit-reached");
  }
});
test("resuming an expired cached batch retains it and starts a separately identified preparation", () => {
  const h = harness({
    session: { id: "session", navigations: 3, startedAt: 0 },
    run: { id: "old-batch", kind: "cached-return", index: 2, paused: true, freshAt: -50000 },
  });
  h.click("Resume visible run");
  assert.equal(h.state().batches[0].id, "old-batch");
  assert.equal(h.state().batches[0].status, "cache-window-expired");
  assert.notEqual(h.state().run.id, "old-batch");
  assert.equal(h.state().run.index, 0);
  assert.equal(h.state().run.preparing, true);
  assert.equal(h.reloads(), 1);
});
test("clearing diagnostics removes only the collector storage and stops collection", () => {
  const h = harness();
  h.click("Clear local measurements");
  assert.equal(h.state(), null);
});

test("failed preparation exposes export without readiness, retains failure, and retries under the original caps", () => {
  const h = harness(
    {
      session: { id: "session", startedAt: 0, navigations: 7 },
      run: { id: "failed-preparation", kind: "cached-return", index: 0, preparing: true },
    },
    false,
  );
  h.advance(30001);
  h.frame();
  assert.equal(h.state().run, undefined);
  assert.equal(h.state().stopReason, "timeout");
  assert.equal(h.state().samples.at(-1).classification, "timeout");
  assert.equal(h.state().samples.at(-1).scheduled, false);
  assert.equal(h.state().batches.at(-1).status, "timeout");
  assert.ok(h.buttons.some((b) => b.textContent === "Export measurements"));
  h.click("Measure cached-return");
  const retried = h.state();
  assert.notEqual(retried.run.id, "failed-preparation");
  assert.equal(retried.session.startedAt, 0);
  assert.equal(retried.session.navigations, 8);
  assert.equal(retried.samples.length, 1);
  const prepared = harness(retried);
  assert.equal(prepared.state().run.preparing, false);
  assert.equal(prepared.state().session.navigations, 9);
  assert.equal(prepared.state().samples[0].classification, "timeout");
});

test("interrupted preparation terminates while visibility and resize still require explicit resume", () => {
  const initial = {
    session: { id: "session", startedAt: 0, navigations: 0 },
    run: { id: "batch", kind: "cached-return", index: 0, preparing: true },
    viewport: { width: 1440, height: 900 },
  };
  const interrupted = harness(initial, false);
  interrupted.emit("pagehide");
  assert.equal(interrupted.state().run, undefined);
  assert.equal(interrupted.state().batches.at(-1).status, "interrupted");
  for (const event of ["visibilitychange", "resize"]) {
    const h = harness(initial, false);
    if (event === "visibilitychange") h.context.document.visibilityState = "hidden";
    else h.context.innerHeight = 800;
    h.emit(event);
    assert.equal(h.state().run.paused, true);
    assert.equal(h.state().batches.length, 0);
    h.context.document.visibilityState = "visible";
    h.context.innerHeight = 900;
    h.emit(event);
    assert.equal(h.state().run.paused, true);
    h.click("Resume visible run");
    assert.equal(h.state().run.paused, false);
    assert.equal(h.reloads(), 1);
  }
});

test("failed preparation cannot restart past either shared limit", () => {
  for (const session of [
    { id: "session", startedAt: 0, navigations: 79 },
    { id: "session", startedAt: -1200000, navigations: 0 },
  ]) {
    const h = harness(
      { session, run: { id: "failed", kind: "cached-return", index: 0, preparing: true } },
      false,
    );
    h.advance(31000);
    h.frame();
    assert.equal(h.state().batches[0].status, "timeout");
    h.click("Measure cached-return");
    h.tick();
    assert.equal(h.state().stopReason, "limit-reached");
    assert.equal(h.state().run, undefined);
    assert.equal(h.reloads(), 0);
    assert.equal(h.state().samples[0].classification, "timeout");
    assert.equal(h.state().session.startedAt, session.startedAt);
  }
});
