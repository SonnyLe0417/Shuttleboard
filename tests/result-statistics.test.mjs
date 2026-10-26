import test from "node:test";
import assert from "node:assert/strict";
import { publicResultStats, publicStats } from "../src/lib/public-profile-stats.server.ts";
import { dashboardStats } from "../src/lib/dashboard-model.ts";
const result = (winner) => ({
  mode: "singles",
  winner,
  team_a_user_ids: ["viewer"],
  team_b_user_ids: ["other"],
});
test("profile totals count wins after the first loss independently of streak", () => {
  assert.deepEqual(publicResultStats(["B", "A", "A"].map(result), "viewer"), {
    matches: 3,
    wins: 2,
    losses: 1,
    winRate: 67,
    currentStreak: 0,
    singles: 3,
    doubles: 0,
  });
  assert.equal(publicResultStats(["A", "A", "B", "A"].map(result), "viewer").currentStreak, 2);
});
test("profile totals walk all result pages", async () => {
  const rows = Array.from({ length: 1005 }, () => result("A"));
  let calls = 0;
  const db = {
    from() {
      const q = {
        select() {
          return q;
        },
        eq() {
          return q;
        },
        or() {
          return q;
        },
        order() {
          return q;
        },
        range(a, b) {
          calls++;
          return { data: rows.slice(a, b + 1) };
        },
      };
      return q;
    },
  };
  assert.equal((await publicStats(db, "viewer")).wins, 1005);
  assert.equal(calls, 3);
});
test("a lost deciding game counts as played but not won", () => {
  const stats = dashboardStats([
    {
      winner: "B",
      games: [
        { a: 21, b: 10 },
        { a: 10, b: 21 },
        { a: 18, b: 21 },
      ],
    },
    {
      winner: "A",
      games: [
        { a: 21, b: 10 },
        { a: 10, b: 21 },
        { a: 21, b: 18 },
      ],
    },
  ]);
  assert.equal(stats.decisiveGames, 2);
  assert.equal(stats.deciderWins, 1);
});
