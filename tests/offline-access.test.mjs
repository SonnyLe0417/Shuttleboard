import test from "node:test";
import assert from "node:assert/strict";
import { localOfflineAccess } from "../src/lib/offline-account.ts";
test("offline authorization fails closed when marker storage is unavailable", () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  try {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem() {
          throw new Error("Synthetic blocked storage");
        },
      },
    });
    assert.equal(localOfflineAccess({ id: "owner", prepared: true, enabled: true }), false);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "localStorage", descriptor);
    else delete globalThis.localStorage;
  }
});
