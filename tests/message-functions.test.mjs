import test from "node:test";
import assert from "node:assert/strict";
import { loadRuntime } from "./fixtures/load-runtime.mjs";
import * as history from "../src/lib/message-history.ts";
const user = "10000000-0000-4000-8000-000000000001",
  other = "10000000-0000-4000-8000-000000000002";
function createServerFn() {
  let validate;
  const builder = {
    middleware() {
      return builder;
    },
    validator(fn) {
      validate = fn;
      return builder;
    },
    handler(fn) {
      return (options) =>
        fn({ ...options, data: validate ? validate(options.data) : options.data });
    },
  };
  return builder;
}
async function functions() {
  return loadRuntime("src/lib/social.functions.ts", {
    "@tanstack/react-start": { createServerFn },
    "@/integrations/supabase/auth-middleware": { requireSupabaseAuth: {} },
    "./message-history": history,
  });
}
function database() {
  const calls = [];
  return {
    calls,
    from(table) {
      const q = {};
      for (const method of ["select", "eq", "or", "order", "limit", "update", "in", "is"])
        q[method] = (...args) => {
          calls.push({ table, method, args });
          return q;
        };
      q.then = (resolve, reject) =>
        Promise.resolve({ data: [], error: null }).then(resolve, reject);
      return q;
    },
  };
}
test("direct and group handlers request newest pages with stable cursor tie-breaks", async () => {
  const handlers = await functions(),
    before = { createdAt: "2026-10-25T10:00:00.123456Z", id: other };
  for (const [name, data, limit] of [
    ["listMessages", { other_id: other, before }, 201],
    ["listGroupMessages", { group_id: other, before }, 301],
  ]) {
    const db = database();
    const result = await handlers[name]({ data, context: { userId: user, supabase: db } });
    assert.equal(result.items.length, 0);
    assert.deepEqual(
      db.calls.filter((c) => c.method === "order").map((c) => [c.args[0], c.args[1].ascending]),
      [
        ["created_at", false],
        ["id", false],
      ],
    );
    assert.equal(db.calls.find((c) => c.method === "limit").args[0], limit);
    const filter = db.calls.find((c) => c.method === "or").args[0];
    assert.ok(filter.includes(`id.lt.${other}`));
    if (name === "listMessages") {
      assert.ok(filter.includes(`sender_id.eq.${user}`));
      assert.ok(filter.includes(`recipient_id.eq.${user}`));
    }
  }
});
test("mark-read updates only supplied incoming IDs, not unseen conversation messages", async () => {
  const handlers = await functions(),
    db = database();
  await handlers.markMessagesRead({
    data: { other_id: other, message_ids: [other] },
    context: { userId: user, supabase: db },
  });
  const filters = db.calls.filter((c) => ["eq", "in", "is"].includes(c.method));
  assert.deepEqual(
    filters.map((c) => Array.from(c.args)),
    [
      ["recipient_id", user],
      ["sender_id", other],
      ["id", [other]],
      ["read_at", null],
    ],
  );
  assert.throws(() =>
    handlers.markMessagesRead({
      data: { other_id: other, message_ids: [] },
      context: { userId: user, supabase: db },
    }),
  );
});
