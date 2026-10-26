import test from "node:test";
import assert from "node:assert/strict";
import {
  authenticateVision,
  readVisionBody,
  reserveVision,
  VISION_BODY_LIMIT,
} from "../src/lib/vision-access.server.ts";
import { createVisionRequester } from "../src/lib/vision-request.ts";
test("AI rejects missing/malformed/invalid auth and fails closed on verification errors", async () => {
  for (const authorization of ["", "public-key", "Bearer a,b", "Bearer a b"]) {
    const response = await authenticateVision(
      new Request("http://local", { headers: { authorization } }),
      () => assert.fail("must not verify malformed input"),
    );
    assert.equal(response.status, 401);
  }
  const req = new Request("http://local", { headers: { authorization: "Bearer synthetic-token" } });
  assert.equal((await authenticateVision(req, async () => null)).status, 401);
  assert.equal(
    (
      await authenticateVision(req, async () => {
        throw Error("offline");
      })
    ).status,
    503,
  );
  assert.equal(
    await authenticateVision(req, async (token) => (token === "synthetic-token" ? "user" : null)),
    "user",
  );
});
test("AI body limit counts actual bytes, including chunked requests", async () => {
  assert.deepEqual(
    await readVisionBody(new Request("http://local", { method: "POST", body: '{"image":"test"}' })),
    { image: "test" },
  );
  assert.equal(
    (await readVisionBody(new Request("http://local", { method: "POST", body: "bad" }))).status,
    400,
  );
  const stream = new ReadableStream({
    start(c) {
      c.enqueue(new Uint8Array(VISION_BODY_LIMIT));
      c.enqueue(new Uint8Array(1));
      c.close();
    },
  });
  assert.equal(
    (
      await readVisionBody(
        new Request("http://local", { method: "POST", body: stream, duplex: "half" }),
      )
    ).status,
    413,
  );
  assert.equal(
    (
      await readVisionBody(
        new Request("http://local", {
          method: "POST",
          headers: { "content-length": String(VISION_BODY_LIMIT + 1) },
          body: "{}",
        }),
      )
    ).status,
    413,
  );
});
test("quota admission fails closed and releases only the admitted lease", async () => {
  assert.equal(
    (await reserveVision("user", { rpc: async () => ({ error: { message: "offline" } }) })).status,
    503,
  );
  assert.equal(
    (await reserveVision("user", { rpc: async () => ({ data: { allowed: true } }) })).status,
    503,
  );
  for (const code of ["minute_limit", "day_limit", "global_limit", "request_in_progress"]) {
    const denied = await reserveVision("user", {
      rpc: async () => ({ data: { allowed: false, code, retry_after: 12.2 } }),
    });
    assert.equal(denied.status, 429);
    assert.equal(denied.headers.get("retry-after"), "13");
  }
  const calls = [];
  const lease = await reserveVision("user", {
    rpc: async (name, args) => {
      calls.push({ name, args });
      return { data: { allowed: true, lease_id: "synthetic-lease" } };
    },
  });
  await lease.release();
  assert.equal(calls[0].args.p_minute_limit, 60);
  assert.equal(calls[0].args.p_day_limit, 1000);
  assert.equal(calls[0].args.p_global_limit, 10000);
  assert.deepEqual(calls[1], {
    name: "release_ai_vision",
    args: { p_user_id: "user", p_lease_id: "synthetic-lease" },
  });
});
test("client attaches token, backs off temporary limits and stops on daily/auth failures", async () => {
  let clock = 0,
    calls = 0;
  let failure = { code: "minute_limit", status: 429 };
  const request = createVisionRequester(
    async () => ({ userId: "u", token: "fake" }),
    async (url, options) => {
      calls++;
      assert.equal(url, "/api/ai-vision");
      assert.equal(options.headers.authorization, "Bearer fake");
      return Response.json(
        { error: "paused", code: failure.code },
        { status: failure.status, headers: { "retry-after": "10" } },
      );
    },
    () => clock,
  );
  await request({});
  assert.equal(request.canSample(), false);
  await request({});
  assert.equal(calls, 1);
  clock = 10001;
  assert.equal(request.canSample(), true);
  failure = { code: "day_limit", status: 429 };
  await request({});
  clock += 86400000;
  assert.equal(request.canSample(), false);
  await request({});
  assert.equal(calls, 2);
  request.resume();
  failure = { code: "sign_in_required", status: 401 };
  await request({});
  assert.equal(request.canSample(), false);
  const anonymous = createVisionRequester(
    async () => null,
    () => assert.fail("anonymous upstream"),
  );
  assert.equal((await anonymous({})).status, 401);
  assert.equal(anonymous.canSample(), false);
});
