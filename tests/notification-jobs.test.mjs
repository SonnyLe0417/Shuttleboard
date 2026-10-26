import test from "node:test";
import assert from "node:assert/strict";
import { authorizeNotificationWorker } from "../src/lib/notification-worker.server.ts";
import { runNotificationJob } from "../src/lib/notification-jobs.server.ts";
import { queueNotification } from "../src/lib/progress.server.ts";
function database({ legacy = false, disabled = false, errorTable = null, quiet = false } = {}) {
  const events = new Map();
  return {
    events,
    from(table) {
      let inserted;
      const result = () => {
        if (table === errorTable) return { error: { message: "forced failure" } };
        if (table === "user_preferences")
          return {
            data: {
              notifications: {
                quiet_hours_enabled: quiet,
                quiet_hours_start: "00:00",
                quiet_hours_end: "00:00",
                match_reminders: !disabled,
                weekly_summary: !disabled,
                reminder_time: `${new Date().getUTCHours()}:00`,
              },
            },
          };
        if (table === "notification_log") return { data: legacy ? { id: "delivered" } : null };
        if (table === "matches")
          return {
            data: [
              {
                winner: "A",
                team_a_user_ids: ["user"],
                team_b_user_ids: [],
                status: "finished",
                longest_rally_seconds: 5,
              },
            ],
          };
        if (table === "notification_events") {
          if (events.has(inserted.event_key)) return { error: { code: "23505" } };
          events.set(inserted.event_key, inserted);
          return { data: { id: "event", available_at: inserted.available_at } };
        }
        throw Error(table);
      };
      const q = {
        select() {
          return q;
        },
        eq() {
          return q;
        },
        gte() {
          return q;
        },
        or() {
          return q;
        },
        order() {
          return q;
        },
        limit() {
          return q;
        },
        insert(value) {
          inserted = value;
          return q;
        },
        maybeSingle() {
          return Promise.resolve(result());
        },
        then(resolve, reject) {
          const r =
            table === "user_preferences"
              ? { ...result(), data: [{ id: "user", notifications: result().data?.notifications }] }
              : result();
          return Promise.resolve(r).then(resolve, reject);
        },
      };
      return q;
    },
  };
}
test("jobs reject public and user tokens and accept only configured private worker token", async () => {
  const db = { rpc: async () => ({ data: { worker_token: "private-synthetic-token" } }) };
  for (const token of ["publishable-key", "user-token", "private-synthetic-tokeX"])
    assert.equal((await authorizeNotificationWorker(token, db)).status, 401);
  assert.equal(await authorizeNotificationWorker("private-synthetic-token", db), true);
  assert.equal(
    (
      await authorizeNotificationWorker("x", {
        rpc: async () => ({ error: { message: "offline" } }),
      })
    ).status,
    503,
  );
});
test("jobs enqueue, report queued counts, deduplicate repeats, and retain legacy suppression", async () => {
  for (const job of ["reminders", "weekly", "inactivity"]) {
    const db = database();
    const first = await runNotificationJob(job, db);
    assert.equal(first.queued, 1);
    assert.equal(first.sent, 0);
    assert.equal(db.events.size, 1);
    assert.equal((await runNotificationJob(job, db)).queued, 0);
    assert.equal((await runNotificationJob(job, database({ legacy: true }))).queued, 0);
    assert.equal((await runNotificationJob(job, database({ disabled: true }))).queued, 0);
  }
});
test("queue defers quiet hours and propagates history/preference/write failures", async () => {
  const db = database({ quiet: true });
  const before = Date.now();
  await queueNotification(db, "user", "quiet", "reminder", "title", "body", "/", { strict: true });
  assert.ok(Date.parse(db.events.get("quiet").available_at) >= before + 86000000);
  for (const table of ["user_preferences", "notification_log", "notification_events"])
    await assert.rejects(runNotificationJob("reminders", database({ errorTable: table })));
});
