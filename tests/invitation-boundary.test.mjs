import test from "node:test";
import assert from "node:assert/strict";
import { respondToInvite } from "../src/lib/invitations.server.ts";
test("invitation boundary preserves actor and rejects write errors or missing receipts", async () => {
  for (const reply of [
    { error: { message: "forced failure" } },
    { data: null },
    { data: { ok: true, accepted: false, match_id: "match" } },
  ])
    await assert.rejects(
      respondToInvite("verified-actor", { id: "invite", accept: true }, { rpc: async () => reply }),
    );
  const calls = [];
  const accepted = await respondToInvite(
    "verified-actor",
    { tokenHash: "hash", accept: true },
    {
      rpc: async (name, args) => {
        calls.push({ name, args });
        return { data: { ok: true, accepted: true, match_id: "match" } };
      },
    },
  );
  assert.equal(accepted.match_id, "match");
  assert.deepEqual(calls[0].args, {
    p_actor_id: "verified-actor",
    p_invite_id: null,
    p_token_hash: "hash",
    p_accept: true,
  });
});
