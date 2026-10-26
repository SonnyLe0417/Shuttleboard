import test from "node:test";
import assert from "node:assert/strict";
import { loadRuntime } from "./fixtures/load-runtime.mjs";
import * as access from "../src/lib/vision-access.server.ts";
import * as geometry from "../src/lib/vision-geometry.ts";
const body = { image: "data:image/jpeg;base64,c3ludGhldGlj" };
const result = {
  shuttleVisible: false,
  position: { x: 0.5, y: 0.5 },
  landed: false,
  call: "unknown",
  pointTo: "none",
  confidence: 0,
  reasoning: "synthetic",
};
async function route(
  overrides = {},
  fetch = () => assert.fail("paid call not expected"),
  globals = {},
) {
  const { Route } = await loadRuntime(
    "src/routes/api/ai-vision.ts",
    {
      "@tanstack/react-router": { createFileRoute: () => (config) => config },
      "@/lib/vision-access.server": { ...access, ...overrides },
      "@/lib/vision-geometry": geometry,
    },
    { fetch, process: { env: { OPENAI_API_KEY: "synthetic-stub-key" } }, ...globals },
  );
  return (value = body, signal) =>
    Route.server.handlers.POST({
      request: new Request("http://synthetic/api/ai-vision", {
        method: "POST",
        body: JSON.stringify(value),
        signal,
      }),
    });
}
test("actual route blocks auth/quota failures before the paid sink", async () => {
  for (const status of [401, 503]) {
    const post = await route({
      authenticateVision: async () => new Response("", { status }),
      reserveVision: () => assert.fail("no quota before auth"),
    });
    assert.equal((await post()).status, status);
  }
  const post = await route({
    authenticateVision: async () => "user",
    reserveVision: async () => new Response("", { status: 429 }),
  });
  assert.equal((await post()).status, 429);
  assert.equal((await post({ image: "invalid" })).status, 400);
});
test("actual route releases reservations on success, upstream rejection, malformed result and timeout", async () => {
  for (const kind of ["success", "rejection", "malformed", "timeout"]) {
    let calls = 0,
      releases = 0,
      timeout;
    const post = await route(
      {
        authenticateVision: async () => "user",
        reserveVision: async () => ({
          release: async () => {
            releases++;
          },
        }),
      },
      async (url, options) => {
        calls++;
        assert.equal(url, "https://api.openai.com/v1/responses");
        assert.ok(options.signal);
        if (kind === "timeout")
          return new Promise((resolve, reject) =>
            options.signal.addEventListener("abort", () => reject(options.signal.reason), {
              once: true,
            }),
          );
        if (kind === "rejection") return new Response("unavailable", { status: 503 });
        return Response.json({
          output_text: kind === "malformed" ? "not json" : JSON.stringify(result),
        });
      },
      {
        AbortSignal: {
          any: AbortSignal.any.bind(AbortSignal),
          timeout(ms) {
            assert.equal(ms, 45000);
            const c = new AbortController();
            timeout = setTimeout(() => c.abort(Error("synthetic timeout")), 5);
            return c.signal;
          },
        },
      },
    );
    try {
      const response = await post();
      assert.ok(response instanceof Response);
      assert.equal(calls, 1);
      assert.equal(releases, 1);
    } finally {
      clearTimeout(timeout);
    }
  }
});
test("server token verifier checks signed-in claims and rejects invalid/expired/anonymous identities", async () => {
  for (const claims of [
    null,
    { sub: "u", role: "authenticated", exp: 1 },
    { sub: "u", role: "anon", exp: 9999999999 },
    { sub: "u", role: "authenticated", exp: 9999999999, is_anonymous: true },
    { sub: "u", role: "authenticated", exp: 9999999999 },
  ]) {
    const loaded = await loadRuntime(
      "src/lib/vision-access.server.ts",
      {
        "@supabase/supabase-js": {
          createClient: () => ({ auth: { getClaims: async () => ({ data: { claims } }) } }),
        },
        "@/integrations/supabase/client.server": { supabaseAdmin: {} },
      },
      { process: { env: { SUPABASE_URL: "http://synthetic", SUPABASE_PUBLISHABLE_KEY: "fake" } } },
    );
    const reply = await loaded.authenticateVision(
      new Request("http://synthetic", { headers: { authorization: "Bearer synthetic" } }),
    );
    if (claims?.role === "authenticated" && claims.exp > 1000000000 && !claims.is_anonymous)
      assert.equal(reply, "u");
    else assert.equal(reply.status, 401);
  }
});
test("the geometric override judges the landing on the court, not the picture", async () => {
  // Camera behind player 1's baseline: p1's half fills most of the picture.
  const { COURT_TO_IMAGE, IMAGE_CORNERS } = await import("./fixtures/annotation-trace.mjs");
  const { applyHomography } = await import("../src/lib/birdie-tracker.ts");
  const at = (x, y) => applyHomography(COURT_TO_IMAGE, { x, y });
  const calls = [];
  for (const [position, call, pointTo] of [
    // 5.5 m from p1's baseline: inside p1's half, so p1 lost the rally.
    [at(0.5, 1 - 5.5 / 13.4), "in", "p2"],
    // Past p1's baseline: p2 hit it out, so p1 wins, whoever hit last.
    [at(0.5, 1.03), "out", "p1"],
    // In the far doubles alley: out in singles, won by p2 at that end.
    [at(0.04, 0.25), "out", "p2"],
  ]) {
    const post = await route(
      {
        authenticateVision: async () => "user",
        reserveVision: async () => ({ release: async () => {} }),
      },
      async () =>
        Response.json({
          output_text: JSON.stringify({
            ...result,
            shuttleVisible: true,
            landed: true,
            confidence: 0.9,
            position: { x: position.x, y: position.y },
            pointTo: "none",
          }),
        }),
    );
    const reply = await (
      await post({ ...body, mode: "singles", courtCorners: IMAGE_CORNERS, lastHitter: "unknown" })
    ).json();
    calls.push([reply.call, reply.pointTo]);
    assert.deepEqual([reply.call, reply.pointTo], [call, pointTo]);
  }
  assert.equal(calls.length, 3);
});
