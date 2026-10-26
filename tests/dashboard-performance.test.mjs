import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { readDashboardCore, readDashboardSummary } from "../src/lib/dashboard.server.ts";
import { dashboardStats } from "../src/lib/dashboard-model.ts";
import { matchForPlayer } from "../src/lib/player-matches.ts";
import { dashboardCoreOptions, dashboardSummaryOptions } from "../src/lib/dashboard-queries.ts";
import { invalidateDashboard } from "../src/lib/query-keys.ts";
import { mergePreferencePatch } from "../src/lib/preferences-patch.ts";
import { dataset, legacyStats, response } from "../benchmarks/dashboard/fixtures.mjs";

function database(count, { fail, newestUnfinished = 0 } = {}) {
  const d = dataset(count),
    calls = [];
  for (const row of d.matches.slice(0, newestUnfinished)) {
    row.winner = null;
    row.status = "active";
  }
  return {
    calls,
    from(table) {
      const call = { table, columns: "*", limit: Infinity, filters: [] };
      calls.push(call);
      const q = {
        select(columns) {
          call.columns = columns;
          return q;
        },
        eq(k, v) {
          call.filters.push([k, v]);
          return q;
        },
        neq() {
          return q;
        },
        in() {
          return q;
        },
        gt() {
          return q;
        },
        or() {
          return q;
        },
        order() {
          return q;
        },
        limit(n) {
          call.limit = n;
          return q;
        },
        maybeSingle() {
          call.single = true;
          return q;
        },
        then(resolve, reject) {
          let rows =
            table === "matches"
              ? d.matches
              : table === "profiles"
                ? [d.profile]
                : table === "user_preferences"
                  ? [{ dashboard: d.dashboard }]
                  : table === "player_progress"
                    ? [{ ...d.progress, quest_cadence: "weekly" }]
                    : table === "player_insights"
                      ? [{ insights: [], stats: { currentStreak: 2 } }]
                      : [];
          if (table === "matches" && call.columns === "id")
            rows = rows.filter((m) => m.winner && m.status !== "abandoned");
          rows = rows
            .slice(0, call.limit)
            .map((row) => Object.fromEntries(call.columns.split(",").map((k) => [k, row[k]])));
          return Promise.resolve({
            data: call.single ? (rows[0] ?? null) : rows,
            error: fail === table ? { message: "unavailable" } : null,
          }).then(resolve, reject);
        },
      };
      return q;
    },
  };
}

test("dashboard core fetches five projected, viewer-relative summaries and the saved goal", async () => {
  const db = database(20);
  const result = await readDashboardCore(db, "example-viewer");
  assert.equal(result.recentMatches.length, 5);
  assert.equal(result.dashboard.goal.title, "Play twice this week");
  assert.equal(result.recentMatches[1].team_a_names[0], "Example opponent");
  assert.equal(result.recentMatches[1].games[0].a, 15);
  assert.equal(result.recentMatches[1].winner, "B");
  assert.ok(!("team_a_user_ids" in result.recentMatches[1]));
  assert.ok(db.calls.every((c) => c.columns !== "*"));
  assert.equal(db.calls.find((c) => c.table === "matches").limit, 5);
});
// Historical fixtures retain the old bug; current expectations correct only decider wins.
function correctedStats(rows) {
  return {
    ...legacyStats(rows),
    deciderWins: rows.filter((row) => row.winner === "A" && row.games.length >= 3).length,
  };
}
test("server aggregates preserve latest-100 selection and inclusive week boundary", async () => {
  for (const count of [0, 20, 100, 150]) {
    const db = database(count),
      weekStart = "2026-10-18T12:00:00.000Z";
    const result = await readDashboardSummary(db, "example-viewer", weekStart);
    const rows = dataset(count)
      .matches.slice(0, 100)
      .map((m) => matchForPlayer(m, "example-viewer"));
    assert.deepEqual(result.stats, correctedStats(rows));
    assert.equal(
      result.weekMatchCount,
      rows.filter((m) => new Date(m.started_at) >= new Date(weekStart)).length,
    );
    assert.equal(result.hasMatches, count > 1);
    assert.equal(
      db.calls.find((c) => c.table === "matches" && c.limit === 100).columns,
      "winner,games,team_a_user_ids,team_b_user_ids,started_at",
    );
    assert.ok(!("matches" in result));
  }
});
test("incomplete matches, deciders and empty games keep existing statistical behavior", () => {
  const rows = [
    { winner: null, games: [] },
    {
      winner: "A",
      games: [
        { a: 21, b: 10 },
        { a: 20, b: 22 },
        { a: 21, b: 19 },
      ],
    },
    {
      winner: "B",
      games: [
        { a: 10, b: 21 },
        { a: 21, b: 19 },
        { a: 18, b: 21 },
      ],
    },
  ];
  assert.deepEqual(dashboardStats(rows), correctedStats(rows));
  assert.deepEqual(dashboardStats([]), {
    wins: 0,
    losses: 0,
    winRate: 0,
    streak: 0,
    avgMargin: "0.0",
    decisiveGames: 0,
    deciderWins: 0,
  });
});
test("core and summary failures reject independently rather than returning empty or zero data", async () => {
  await assert.rejects(
    readDashboardCore(database(20, { fail: "profiles" }), "example-viewer"),
    /unavailable/,
  );
  await assert.rejects(
    readDashboardSummary(
      database(20, { fail: "player_progress" }),
      "example-viewer",
      "2026-10-19T00:00:00Z",
    ),
    /unavailable/,
  );
  assert.equal(
    (await readDashboardCore(database(20, { fail: "player_progress" }), "example-viewer"))
      .recentMatches.length,
    5,
  );
});
test("an older completed match still counts when the latest 100 are unfinished", async () => {
  const result = await readDashboardSummary(
    database(150, { newestUnfinished: 100 }),
    "example-viewer",
    "2026-10-19T00:00:00Z",
  );
  assert.equal(result.hasMatches, true);
  assert.equal(result.stats.wins, 0);
  assert.equal(result.stats.losses, 0);
});
test("benchmark response payloads match the real projected service output", async () => {
  for (const count of [0, 20, 100]) {
    const input = { data: { weekStart: "2026-10-19T07:00:00.000Z" } };
    assert.deepEqual(
      JSON.parse(JSON.stringify(await readDashboardCore(database(count), "example-viewer"))),
      response("optimized", "core", count, input),
    );
    const expected = response("optimized", "summary", count, input);
    expected.stats = correctedStats(
      dataset(count)
        .matches.slice(0, 100)
        .map((m) => matchForPlayer(m, "example-viewer")),
    );
    assert.deepEqual(
      await readDashboardSummary(database(count), "example-viewer", input.data.weekStart),
      expected,
    );
  }
});
test("browser-local Monday survives Sunday, DST and non-hour timezones", () => {
  const moduleUrl = new URL("../src/lib/dashboard-model.ts", import.meta.url).href;
  for (const [tz, date, expected] of [
    ["America/Los_Angeles", "2026-11-01T20:00:00Z", "2026-10-26T07:00:00.000Z"],
    ["America/Los_Angeles", "2026-11-02T20:00:00Z", "2026-11-02T08:00:00.000Z"],
    ["Asia/Kolkata", "2026-10-19T03:00:00Z", "2026-10-18T18:30:00.000Z"],
    ["UTC", "2026-10-18T23:59:59Z", "2026-10-12T00:00:00.000Z"],
  ]) {
    const value = execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `import {localWeekStart} from ${JSON.stringify(moduleUrl)};console.log(localWeekStart(new Date(${JSON.stringify(date)})));`,
      ],
      { env: { ...process.env, TZ: tz }, encoding: "utf8" },
    ).trim();
    assert.equal(value, expected);
  }
});
test("loader and component share requests; cached returns are immediate and stale returns refresh", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let calls = 0;
  const options = dashboardCoreOptions(async () => {
    calls++;
    return { profile: null, dashboard: {}, recentMatches: [] };
  });
  try {
    await Promise.all([client.prefetchQuery(options), client.fetchQuery(options)]);
    assert.equal(calls, 1);
    await client.fetchQuery(options);
    assert.equal(calls, 1);
    client.setQueryData(options.queryKey, client.getQueryData(options.queryKey), {
      updatedAt: Date.now() - 61_000,
    });
    const observer = new QueryObserver(client, options),
      stop = observer.subscribe(() => {});
    assert.equal(observer.getCurrentResult().data.recentMatches.length, 0);
    await client.fetchQuery(options);
    assert.equal(calls, 2);
    stop();
  } finally {
    client.clear();
  }
});
test("dashboard invalidation covers every week without invalidating History; account cache clearing removes all data", async () => {
  const client = new QueryClient();
  try {
    client.setQueryData(["dashboard", "core"], { example: true });
    for (const week of ["2026-10-12T00:00:00Z", "2026-10-19T00:00:00Z"]) {
      const o = dashboardSummaryOptions(async () => ({}), week);
      client.setQueryData(o.queryKey, {});
    }
    client.setQueryData(["matches", "mine"], [{ id: "example" }]);
    await invalidateDashboard(client);
    assert.ok(
      client
        .getQueryCache()
        .findAll({ queryKey: ["dashboard"] })
        .every((q) => q.state.isInvalidated),
    );
    assert.equal(client.getQueryState(["matches", "mine"]).isInvalidated, false);
    client.clear();
    assert.equal(client.getQueryCache().getAll().length, 0);
  } finally {
    client.clear();
  }
});
test("goal-only preference patches retain public profile, accessibility and unrelated dashboard preferences", () => {
  const current = {
    public_profile_enabled: true,
    dashboard: { layout: "stats-heavy", coaching_tone: "technical" },
    notifications: { weekly_summary: true },
    accessibility: { text_scale: "large" },
    match_defaults: { mode: "doubles" },
  };
  const next = mergePreferencePatch(
    current,
    { dashboard: { goal: { title: "Practice", target: 3, progress: 0, unit: "sessions" } } },
    "example-viewer",
  );
  assert.equal(next.public_profile_enabled, true);
  assert.equal(next.dashboard.layout, "stats-heavy");
  assert.deepEqual(next.notifications, current.notifications);
  assert.deepEqual(next.accessibility, current.accessibility);
  assert.deepEqual(next.match_defaults, current.match_defaults);
  assert.equal(
    mergePreferencePatch(current, { public_profile_enabled: false }, "example-viewer")
      .public_profile_enabled,
    false,
  );
});
