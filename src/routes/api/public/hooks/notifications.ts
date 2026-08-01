import { createFileRoute } from "@tanstack/react-router";

// Public cron endpoint. Auth: caller must present the Supabase publishable key
// via `apikey` header, matching pg_cron scheduling convention.
export const Route = createFileRoute("/api/public/hooks/notifications")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apikey =
          request.headers.get("apikey") ??
          request.headers.get("authorization")?.replace(/^Bearer\s+/, "");
        if (!apikey || apikey !== process.env.SUPABASE_PUBLISHABLE_KEY) {
          return new Response("Unauthorized", { status: 401 });
        }
        const url = new URL(request.url);
        const job = url.searchParams.get("job") ?? "";

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { sendToUser } = await import("@/lib/push.server");

        if (job === "reminders") return json(await runReminders(supabaseAdmin, sendToUser));
        if (job === "weekly") return json(await runWeekly(supabaseAdmin, sendToUser));
        if (job === "inactivity") return json(await runInactivity(supabaseAdmin, sendToUser));
        return new Response("Unknown job", { status: 400 });
      },
    },
  },
});

function json(data: unknown) {
  return new Response(JSON.stringify(data), {
    headers: { "content-type": "application/json" },
  });
}

async function alreadySent(admin: any, user_id: string, kind: string, bucket: string) {
  const { data } = await admin
    .from("notification_log")
    .select("id")
    .eq("user_id", user_id)
    .eq("kind", kind)
    .eq("bucket", bucket)
    .maybeSingle();
  return !!data;
}

async function logSent(admin: any, user_id: string, kind: string, bucket: string) {
  await admin.from("notification_log").insert({ user_id, kind, bucket }).select("id");
}

// Fires hourly. If the user's reminder_time HH matches the current UTC hour and
// they have match_reminders enabled, send a nudge (once per day).
async function runReminders(admin: any, send: any) {
  const now = new Date();
  const hour = now.getUTCHours();
  const bucket = now.toISOString().slice(0, 10);
  const { data: prefs } = await admin.from("user_preferences").select("id, notifications");

  let sent = 0;
  for (const row of prefs ?? []) {
    const n = (row.notifications as any) ?? {};
    if (!n.match_reminders) continue;
    const rt = String(n.reminder_time ?? "18:00");
    const rHour = parseInt(rt.split(":")[0] ?? "18", 10);
    if (rHour !== hour) continue;
    if (await alreadySent(admin, row.id, "reminder_daily", bucket)) continue;
    const res = await send(admin, row.id, {
      title: "Time to play 🏸",
      body: "Grab your racket — log a match when you're done.",
      url: "/",
      tag: "reminder-daily",
    });
    if (res.sent > 0) {
      await logSent(admin, row.id, "reminder_daily", bucket);
      sent++;
    }
  }
  return { job: "reminders", processed: prefs?.length ?? 0, sent };
}

// Runs Mondays at 09:00 UTC. Summarize the previous week.
async function runWeekly(admin: any, send: any) {
  const now = new Date();
  const bucket = weekBucket(now);
  const { data: prefs } = await admin.from("user_preferences").select("id, notifications");

  const since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  let sent = 0;
  for (const row of prefs ?? []) {
    const n = (row.notifications as any) ?? {};
    if (n.weekly_summary === false) continue;
    if (await alreadySent(admin, row.id, "weekly_summary", bucket)) continue;

    const { data: matches } = await admin
      .from("matches")
      .select("winner, team_a_user_ids, team_b_user_ids, longest_rally_seconds, status")
      .gte("finished_at", since)
      .eq("status", "finished");

    const mine = (matches ?? []).filter(
      (m: any) => m.team_a_user_ids?.includes(row.id) || m.team_b_user_ids?.includes(row.id),
    );
    if (mine.length === 0) continue;
    const wins = mine.filter((m: any) => {
      const onA = m.team_a_user_ids?.includes(row.id);
      return (onA && m.winner === "A") || (!onA && m.winner === "B");
    }).length;
    const rate = Math.round((wins / mine.length) * 100);
    const longest = Math.max(0, ...mine.map((m: any) => m.longest_rally_seconds ?? 0));
    const res = await send(admin, row.id, {
      title: "Your week in badminton 📊",
      body: `${mine.length} matches, ${wins} wins (${rate}%). Longest rally: ${longest}s.`,
      url: "/history",
      tag: "weekly",
    });
    if (res.sent > 0) {
      await logSent(admin, row.id, "weekly_summary", bucket);
      sent++;
    }
  }
  return { job: "weekly", sent };
}

// Runs daily. If user hasn't played in 3+ days and match_reminders enabled.
async function runInactivity(admin: any, send: any) {
  const now = new Date();
  const bucket = now.toISOString().slice(0, 10);
  const { data: prefs } = await admin.from("user_preferences").select("id, notifications");

  let sent = 0;
  for (const row of prefs ?? []) {
    const n = (row.notifications as any) ?? {};
    if (!n.match_reminders) continue;
    if (await alreadySent(admin, row.id, "reminder_inactivity", bucket)) continue;

    const { data: last } = await admin
      .from("matches")
      .select("finished_at")
      .or(`team_a_user_ids.cs.{${row.id}},team_b_user_ids.cs.{${row.id}}`)
      .eq("status", "finished")
      .order("finished_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const lastAt = last?.finished_at ? new Date(last.finished_at).getTime() : 0;
    const days = lastAt ? Math.floor((now.getTime() - lastAt) / 86400000) : 999;
    if (days < 3) continue;

    const res = await send(admin, row.id, {
      title: "Miss the court? 🏸",
      body: `It's been ${days} days since your last match. Time for a rematch?`,
      url: "/",
      tag: "reminder-inactivity",
    });
    if (res.sent > 0) {
      await logSent(admin, row.id, "reminder_inactivity", bucket);
      sent++;
    }
  }
  return { job: "inactivity", sent };
}

function weekBucket(d: Date) {
  const dt = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = dt.getUTCDay() || 7;
  dt.setUTCDate(dt.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((dt.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${dt.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}
