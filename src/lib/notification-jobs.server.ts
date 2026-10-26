import { queueNotification } from "./progress.server";
type Payload = { title: string; body: string; url?: string; tag?: string };
async function enqueueLegacy(
  db: any,
  userId: string,
  payload: Payload,
  kind: string,
  bucket: string,
) {
  const queued = await queueNotification(
    db,
    userId,
    `legacy:${kind}:${bucket}`,
    kind === "weekly_summary" ? "summary" : "reminder",
    payload.title,
    payload.body,
    payload.url ?? "/",
    { strict: true },
  );
  return { queued };
}
export async function runNotificationJob(job: string, db: any) {
  if (job === "reminders") return runReminders(db, enqueueLegacy);
  if (job === "weekly") return runWeekly(db, enqueueLegacy);
  if (job === "inactivity") return runInactivity(db, enqueueLegacy);
  throw Error("Unknown notification job");
}
async function alreadySent(admin: any, user_id: string, kind: string, bucket: string) {
  const { data, error } = await admin
    .from("notification_log")
    .select("id")
    .eq("user_id", user_id)
    .eq("kind", kind)
    .eq("bucket", bucket)
    .maybeSingle();
  if (error) throw new Error("Legacy notification history unavailable");
  return !!data;
}

// Fires hourly. If the user's reminder_time HH matches the current UTC hour and
// they have match_reminders enabled, send a nudge (once per day).
async function runReminders(admin: any, enqueue: typeof enqueueLegacy) {
  const now = new Date();
  const hour = now.getUTCHours();
  const bucket = now.toISOString().slice(0, 10);
  const { data: prefs, error: preferencesError } = await admin
    .from("user_preferences")
    .select("id, notifications");
  if (preferencesError) throw new Error("Notification preferences unavailable");

  let queued = 0;
  for (const row of prefs ?? []) {
    const n = (row.notifications as any) ?? {};
    if (!n.match_reminders) continue;
    const rt = String(n.reminder_time ?? "18:00");
    const rHour = parseInt(rt.split(":")[0] ?? "18", 10);
    if (rHour !== hour) continue;
    if (await alreadySent(admin, row.id, "reminder_daily", bucket)) continue;
    const res = await enqueue(
      admin,
      row.id,
      {
        title: "Time to play 🏸",
        body: "Grab your racket — log a match when you're done.",
        url: "/",
        tag: "reminder-daily",
      },
      "reminder_daily",
      bucket,
    );
    if (res.queued) queued++;
  }
  return { job: "reminders", processed: prefs?.length ?? 0, sent: 0, queued };
}

// Runs Mondays at 09:00 UTC. Summarize the previous week.
async function runWeekly(admin: any, enqueue: typeof enqueueLegacy) {
  const now = new Date();
  const bucket = weekBucket(now);
  const { data: prefs, error: preferencesError } = await admin
    .from("user_preferences")
    .select("id, notifications");
  if (preferencesError) throw new Error("Notification preferences unavailable");

  const since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  let queued = 0;
  for (const row of prefs ?? []) {
    const n = (row.notifications as any) ?? {};
    if (n.weekly_summary === false) continue;
    if (await alreadySent(admin, row.id, "weekly_summary", bucket)) continue;

    const { data: matches, error: matchesError } = await admin
      .from("matches")
      .select("winner, team_a_user_ids, team_b_user_ids, longest_rally_seconds, status")
      .gte("finished_at", since)
      .eq("status", "finished");

    if (matchesError) throw new Error("Notification match history unavailable");
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
    const res = await enqueue(
      admin,
      row.id,
      {
        title: "Your week in badminton 📊",
        body: `${mine.length} matches, ${wins} wins (${rate}%). Longest rally: ${longest}s.`,
        url: "/history",
        tag: "weekly",
      },
      "weekly_summary",
      bucket,
    );
    if (res.queued) queued++;
  }
  return { job: "weekly", sent: 0, queued };
}

// Runs daily. If user hasn't played in 3+ days and match_reminders enabled.
async function runInactivity(admin: any, enqueue: typeof enqueueLegacy) {
  const now = new Date();
  const bucket = now.toISOString().slice(0, 10);
  const { data: prefs, error: preferencesError } = await admin
    .from("user_preferences")
    .select("id, notifications");
  if (preferencesError) throw new Error("Notification preferences unavailable");

  let queued = 0;
  for (const row of prefs ?? []) {
    const n = (row.notifications as any) ?? {};
    if (!n.match_reminders) continue;
    if (await alreadySent(admin, row.id, "reminder_inactivity", bucket)) continue;

    const { data: last, error: lastError } = await admin
      .from("matches")
      .select("finished_at")
      .or(`team_a_user_ids.cs.{${row.id}},team_b_user_ids.cs.{${row.id}}`)
      .eq("status", "finished")
      .order("finished_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (lastError) throw new Error("Notification match history unavailable");
    const lastAt = last?.finished_at ? new Date(last.finished_at).getTime() : 0;
    const days = lastAt ? Math.floor((now.getTime() - lastAt) / 86400000) : 999;
    if (days < 3) continue;

    const res = await enqueue(
      admin,
      row.id,
      {
        title: "Miss the court? 🏸",
        body: `It's been ${days} days since your last match. Time for a rematch?`,
        url: "/",
        tag: "reminder-inactivity",
      },
      "reminder_inactivity",
      bucket,
    );
    if (res.queued) queued++;
  }
  return { job: "inactivity", sent: 0, queued };
}

function weekBucket(d: Date) {
  const dt = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = dt.getUTCDay() || 7;
  dt.setUTCDate(dt.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((dt.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${dt.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}
