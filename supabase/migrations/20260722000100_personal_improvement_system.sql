-- Personal improvement system

CREATE TABLE IF NOT EXISTS public.player_insights (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  insights JSONB NOT NULL DEFAULT '[]'::jsonb,
  focus_areas TEXT[] NOT NULL DEFAULT '{}',
  source_match_count INT NOT NULL DEFAULT 0,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.coach_quests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  cadence TEXT NOT NULL CHECK (cadence IN ('weekly', 'monthly')),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL,
  target_value INT NOT NULL DEFAULT 1,
  progress INT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'skipped', 'expired')),
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.personal_bests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  metric_key TEXT NOT NULL,
  value NUMERIC NOT NULL,
  unit TEXT NOT NULL,
  source_match_id UUID REFERENCES public.matches(id) ON DELETE SET NULL,
  achieved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, metric_key)
);

CREATE TABLE IF NOT EXISTS public.match_reflections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  match_id UUID NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
  went_well TEXT NOT NULL DEFAULT '',
  difficult TEXT NOT NULL DEFAULT '',
  next_focus TEXT NOT NULL DEFAULT '',
  confidence_before INT CHECK (confidence_before BETWEEN 1 AND 5),
  confidence_after INT CHECK (confidence_after BETWEEN 1 AND 5),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, match_id)
);

CREATE TABLE IF NOT EXISTS public.opponent_memories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  opponent_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  opponent_key TEXT NOT NULL,
  opponent_name TEXT NOT NULL,
  worked TEXT NOT NULL DEFAULT '',
  difficult TEXT NOT NULL DEFAULT '',
  tendencies TEXT NOT NULL DEFAULT '',
  next_plan TEXT NOT NULL DEFAULT '',
  match_count INT NOT NULL DEFAULT 0,
  wins INT NOT NULL DEFAULT 0,
  losses INT NOT NULL DEFAULT 0,
  last_played_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, opponent_key)
);

CREATE TABLE IF NOT EXISTS public.player_progress (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  total_xp INT NOT NULL DEFAULT 0,
  current_level INT NOT NULL DEFAULT 1,
  celebration_enabled BOOLEAN NOT NULL DEFAULT true,
  streaks_enabled BOOLEAN NOT NULL DEFAULT true,
  quest_cadence TEXT NOT NULL DEFAULT 'weekly' CHECK (quest_cadence IN ('weekly', 'monthly')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.reward_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_key TEXT NOT NULL,
  kind TEXT NOT NULL,
  xp INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, event_key)
);

CREATE TABLE IF NOT EXISTS public.player_achievements (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  achievement_key TEXT NOT NULL,
  award_key TEXT NOT NULL,
  earned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, achievement_key)
);

CREATE INDEX IF NOT EXISTS coach_quests_user_period_idx ON public.coach_quests(user_id, starts_at DESC);
CREATE INDEX IF NOT EXISTS personal_bests_user_idx ON public.personal_bests(user_id, achieved_at DESC);
CREATE INDEX IF NOT EXISTS opponent_memories_user_idx ON public.opponent_memories(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS reward_events_user_idx ON public.reward_events(user_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.player_insights, public.coach_quests, public.personal_bests,
  public.match_reflections, public.opponent_memories, public.player_progress, public.reward_events,
  public.player_achievements TO authenticated;
GRANT ALL ON public.player_insights, public.coach_quests, public.personal_bests, public.match_reflections,
  public.opponent_memories, public.player_progress, public.reward_events, public.player_achievements TO service_role;

ALTER TABLE public.player_insights ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coach_quests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.personal_bests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.match_reflections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.opponent_memories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.player_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reward_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.player_achievements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own insights" ON public.player_insights FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users manage own quests" ON public.coach_quests FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users manage own personal bests" ON public.personal_bests FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users manage own reflections" ON public.match_reflections FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users manage own opponent memories" ON public.opponent_memories FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users manage own progress" ON public.player_progress FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users view own reward events" ON public.reward_events FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Users view own achievements" ON public.player_achievements FOR SELECT TO authenticated USING (user_id = auth.uid());

