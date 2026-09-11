function localMinutes(date: Date, timezone: string) {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(date);
    const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0) % 24;
    const minute = Number(parts.find((part) => part.type === "minute")?.value ?? 0);
    return hour * 60 + minute;
  } catch {
    return date.getUTCHours() * 60 + date.getUTCMinutes();
  }
}

function parseClock(value: unknown, fallback: number) {
  const match = typeof value === "string" ? /^(\d{2}):(\d{2})$/.exec(value) : null;
  if (!match) return fallback;
  return Math.min(1439, Number(match[1]) * 60 + Number(match[2]));
}

function inClockWindow(minutes: number, start: number, end: number) {
  if (start === end) return true;
  return start < end ? minutes >= start && minutes < end : minutes >= start || minutes < end;
}

export function nextAllowedNotificationAt(now: Date, notifications: Record<string, any>) {
  const timezone = typeof notifications.timezone === "string" ? notifications.timezone : "UTC";
  const scheduleEnabled = notifications.schedule_enabled === true;
  const quietEnabled = notifications.quiet_hours_enabled === true;
  const scheduleStart = parseClock(notifications.schedule_start, 8 * 60);
  const scheduleEnd = parseClock(notifications.schedule_end, 21 * 60);
  const quietStart = parseClock(notifications.quiet_hours_start, 22 * 60);
  const quietEnd = parseClock(notifications.quiet_hours_end, 7 * 60);
  const allowed = (date: Date) => {
    const minutes = localMinutes(date, timezone);
    return (
      (!scheduleEnabled || inClockWindow(minutes, scheduleStart, scheduleEnd)) &&
      (!quietEnabled || !inClockWindow(minutes, quietStart, quietEnd))
    );
  };
  if (allowed(now)) return now.toISOString();
  const cursor = new Date(now);
  for (let minute = 1; minute <= 60 * 48; minute += 1) {
    cursor.setTime(now.getTime() + minute * 60_000);
    if (allowed(cursor)) return cursor.toISOString();
  }
  return null;
}

export function notificationEnabled(preferences: Record<string, any>, type: string) {
  const keys: Record<string, string> = {
    quest: "quest_reminders",
    level_up: "level_up_notifications",
    achievement: "achievement_notifications",
    reminder: "match_reminders",
    summary: "weekly_summary",
    streak: "win_streak_alerts",
  };
  return !!keys[type] && preferences[keys[type]] !== false;
}
