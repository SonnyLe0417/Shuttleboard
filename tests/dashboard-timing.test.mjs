import test from "node:test";
import assert from "node:assert/strict";
import { dashboardTimer } from "../src/lib/dashboard-timing.ts";

test("dashboard spans measure concurrent work independently and retain failed durations", async () => {
  let clock = 0;
  const timer = dashboardTimer(() => clock);
  clock = 4;
  timer.mark("auth_setup");
  let finishMatches, finishQuests;
  const matches = timer.measure(
    "matches",
    () =>
      new Promise((resolve) => {
        finishMatches = resolve;
      }),
  );
  const quests = timer.measure(
    "quests",
    () =>
      new Promise((resolve) => {
        finishQuests = resolve;
      }),
  );
  clock = 14;
  finishMatches("unchanged");
  assert.equal(await matches, "unchanged");
  clock = 34;
  finishQuests();
  await quests;
  await assert.rejects(
    timer.measure("insights", () => {
      clock = 39;
      throw new Error("private failure");
    }),
  );
  timer.mark("total");
  assert.equal(
    timer.header(),
    "dash_auth_setup;dur=4.0, dash_matches;dur=10.0, dash_quests;dur=30.0, dash_insights;dur=5.0, dash_total;dur=39.0",
  );
  assert.ok(!timer.header().includes("private"));
});
