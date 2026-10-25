import test from "node:test";
import assert from "node:assert/strict";
import { deferredSubscription } from "../src/lib/deferred-subscription.ts";
import { createSessionStore } from "../src/lib/session-store.ts";

test("session stays pending until deferred SDK subscription publishes and follows sign-out", async () => {
  let ready,
    publish,
    disconnected = 0;
  const promise = new Promise((resolve) => {
    ready = resolve;
  });
  const store = createSessionStore((emit) =>
    deferredSubscription(
      promise,
      () => {
        publish = emit;
        return () => disconnected++;
      },
      () => assert.fail("Unexpected failure"),
    ),
  );
  const stop = store.subscribe(() => {});
  assert.equal(store.getSnapshot().loading, true);
  ready();
  await promise;
  await Promise.resolve();
  assert.equal(store.getSnapshot().loading, true);
  publish({ user: { id: "synthetic-one" } });
  assert.equal(store.getSnapshot().loading, false);
  publish(null);
  assert.equal(store.getSnapshot().user, null);
  stop();
  assert.equal(disconnected, 1);
});
test("a subscription cancelled before module load cannot attach a stale listener", async () => {
  let resolve,
    connected = 0;
  const ready = new Promise((done) => {
    resolve = done;
  });
  const stop = deferredSubscription(
    ready,
    () => {
      connected++;
      return () => {};
    },
    () => {},
  );
  stop();
  resolve();
  await ready;
  await Promise.resolve();
  assert.equal(connected, 0);
});
test("module failures are reported without publishing an unauthenticated session", async () => {
  const error = new Error("synthetic module failure");
  let connected = false,
    seen;
  deferredSubscription(
    Promise.reject(error),
    () => {
      connected = true;
      return () => {};
    },
    (value) => {
      seen = value;
    },
  );
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(connected, false);
  assert.equal(seen, error);
});

test("deferred import and setup failures reach the store without automatic retries", async () => {
  for (const setupFailure of [false, true]) {
    const error = new Error("synthetic auth failure");
    let attempts = 0;
    const store = createSessionStore((publish, fail) => {
      attempts++;
      return deferredSubscription(
        setupFailure ? Promise.resolve() : Promise.reject(error),
        () => {
          throw error;
        },
        fail,
      );
    });
    const stop = store.subscribe(() => {});
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(store.getSnapshot().loading, false);
    assert.equal(store.getSnapshot().error, error);
    const second = store.subscribe(() => {});
    assert.equal(attempts, 1);
    second();
    stop();
  }
});

test("synchronous setup errors are recoverable and stale failures cannot replace a new session", () => {
  const error = new Error("setup failed");
  const broken = createSessionStore(() => {
    throw error;
  });
  const dispose = broken.subscribe(() => {});
  assert.equal(broken.getSnapshot().error, error);
  assert.equal(broken.getSnapshot().loading, false);
  dispose();
  let emit, fail;
  const store = createSessionStore((publish, failure) => {
    emit = publish;
    fail = failure;
    return () => {};
  });
  const stop = store.subscribe(() => {});
  const oldFail = fail;
  stop();
  const stopNew = store.subscribe(() => {});
  emit({ user: { id: "synthetic" } });
  oldFail(error);
  assert.equal(store.getSnapshot().error, null);
  assert.equal(store.getSnapshot().user.id, "synthetic");
  fail(error);
  assert.equal(store.getSnapshot().user.id, "synthetic");
  emit(null);
  assert.equal(store.getSnapshot().error, null);
  assert.equal(store.getSnapshot().user, null);
  stopNew();
});
