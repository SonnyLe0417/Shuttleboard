/** A partial appearance/dashboard save must not reset unrelated saved preferences. */
export function mergePreferencePatch(
  current: Record<string, any>,
  patch: Record<string, any>,
  userId: string,
) {
  return {
    id: userId,
    match_defaults: { ...current.match_defaults, ...patch.match_defaults },
    dashboard: { ...current.dashboard, ...patch.dashboard },
    notifications: { ...current.notifications, ...patch.notifications },
    accessibility: { ...current.accessibility, ...patch.accessibility },
    public_profile_enabled: patch.public_profile_enabled ?? current.public_profile_enabled ?? false,
  };
}
