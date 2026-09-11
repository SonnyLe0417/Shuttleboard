export const ACHIEVEMENTS = [
  ["first-match", "First Match", "Save your first completed result.", "court-journal-accent"],
  [
    "first-reflection",
    "First Reflection",
    "Write your first post-match lesson.",
    "reflection-frame",
  ],
  [
    "first-personal-best",
    "Personal Best",
    "Set a new best in any tracked category.",
    "personal-best-summary",
  ],
  ["three-match-streak", "On a Streak", "Win three completed matches in a row.", "momentum-accent"],
  ["five-reflections", "Court Journal", "Complete five reflections.", "reflection-coaching"],
  ["three-quests", "Focused Player", "Complete three coach quests.", "quest-focus-frame"],
  [
    "decider-tested",
    "Decider Tested",
    "Finish three matches that reach a deciding game.",
    "decider-coaching-prompt",
  ],
  [
    "comeback",
    "Comeback Match",
    "Win a match after losing the opening game.",
    "comeback-celebration",
  ],
  [
    "opponent-analyst",
    "Opponent Analyst",
    "Save a private strategy memory.",
    "opponent-comparison",
  ],
  [
    "consistent-player",
    "Consistent Player",
    "Play two matches in one quest period.",
    "extra-progress-filter",
  ],
] as const;

export function eligibleAchievements(
  matches: any[],
  reflections: any[],
  bests: any[],
  quests: any[],
  memories: any[],
) {
  const finished = matches.filter((m) => m.status !== "abandoned" && m.winner);
  const chronological = [...finished].sort(
    (a, b) => Date.parse(a.started_at) - Date.parse(b.started_at),
  );
  let streak = 0;
  let longest = 0;
  for (const match of chronological) {
    streak = match.winner === "A" ? streak + 1 : 0;
    longest = Math.max(longest, streak);
  }
  const thoughtful = reflections.filter((r) =>
    [r.went_well, r.difficult, r.next_focus].some((v) => String(v ?? "").trim()),
  );
  const notes = memories.filter((m) =>
    [m.worked, m.difficult, m.tendencies, m.next_plan].some((v) => String(v ?? "").trim()),
  );
  const flags: Record<string, boolean> = {
    "first-match": finished.length > 0,
    "first-reflection": thoughtful.length > 0,
    "first-personal-best": bests.length > 0,
    "three-match-streak": longest >= 3,
    "five-reflections": thoughtful.length >= 5,
    "three-quests": quests.filter((q) => q.status === "completed").length >= 3,
    "decider-tested":
      finished.filter((m) => (m.best_of ?? 3) > 1 && m.games?.length === (m.best_of ?? 3)).length >=
      3,
    comeback: finished.some((m) => m.winner === "A" && m.games?.[0]?.a < m.games?.[0]?.b),
    "opponent-analyst": notes.length > 0,
    "consistent-player": quests.some(
      (q) =>
        finished.filter((m) => m.started_at >= q.starts_at && m.started_at < q.ends_at).length >= 2,
    ),
  };
  return ACHIEVEMENTS.filter(([key]) => flags[key]).map(([achievement_key, , , award_key]) => ({
    achievement_key,
    award_key,
  }));
}
