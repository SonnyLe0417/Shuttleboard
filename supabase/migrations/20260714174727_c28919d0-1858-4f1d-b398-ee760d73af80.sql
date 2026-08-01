
-- PROFILES
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  handle TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Profiles are viewable by authenticated users"
  ON public.profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users insert own profile"
  ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);
CREATE POLICY "Users update own profile"
  ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
CREATE POLICY "Users delete own profile"
  ON public.profiles FOR DELETE TO authenticated USING (auth.uid() = id);

-- updated_at trigger fn
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  base_handle TEXT;
  final_handle TEXT;
  n INT := 0;
BEGIN
  base_handle := lower(regexp_replace(
    coalesce(NEW.raw_user_meta_data->>'handle',
             split_part(coalesce(NEW.email, 'player'), '@', 1)),
    '[^a-z0-9_]', '', 'g'));
  IF base_handle = '' OR base_handle IS NULL THEN base_handle := 'player'; END IF;
  final_handle := base_handle;
  WHILE EXISTS (SELECT 1 FROM public.profiles WHERE handle = final_handle) LOOP
    n := n + 1;
    final_handle := base_handle || n::text;
  END LOOP;

  INSERT INTO public.profiles (id, handle, display_name, avatar_url)
  VALUES (
    NEW.id,
    final_handle,
    coalesce(NEW.raw_user_meta_data->>'display_name',
             NEW.raw_user_meta_data->>'full_name',
             final_handle),
    NEW.raw_user_meta_data->>'avatar_url'
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- MATCHES
CREATE TABLE public.matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  mode TEXT NOT NULL CHECK (mode IN ('singles','doubles')),
  format TEXT NOT NULL,
  points_to_win INT NOT NULL,
  best_of INT NOT NULL DEFAULT 3,
  -- Team A
  team_a_names TEXT[] NOT NULL,
  team_a_user_ids UUID[] NOT NULL DEFAULT '{}',
  -- Team B
  team_b_names TEXT[] NOT NULL,
  team_b_user_ids UUID[] NOT NULL DEFAULT '{}',
  -- Results
  games JSONB NOT NULL DEFAULT '[]'::jsonb,
  games_won_a INT NOT NULL DEFAULT 0,
  games_won_b INT NOT NULL DEFAULT 0,
  winner TEXT CHECK (winner IN ('A','B')),
  status TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress','finished','abandoned')),
  duration_seconds INT NOT NULL DEFAULT 0,
  longest_rally_seconds INT NOT NULL DEFAULT 0,
  total_rallies INT NOT NULL DEFAULT 0,
  notes TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.matches TO authenticated;
GRANT ALL ON public.matches TO service_role;
ALTER TABLE public.matches ENABLE ROW LEVEL SECURITY;

CREATE INDEX matches_creator_idx ON public.matches(creator_id);
CREATE INDEX matches_team_a_users_idx ON public.matches USING GIN (team_a_user_ids);
CREATE INDEX matches_team_b_users_idx ON public.matches USING GIN (team_b_user_ids);
CREATE INDEX matches_started_at_idx ON public.matches(started_at DESC);

CREATE POLICY "Players can view their matches"
  ON public.matches FOR SELECT TO authenticated
  USING (
    auth.uid() = creator_id
    OR auth.uid() = ANY(team_a_user_ids)
    OR auth.uid() = ANY(team_b_user_ids)
  );
CREATE POLICY "Creator inserts matches"
  ON public.matches FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = creator_id);
CREATE POLICY "Creator updates matches"
  ON public.matches FOR UPDATE TO authenticated
  USING (auth.uid() = creator_id) WITH CHECK (auth.uid() = creator_id);
CREATE POLICY "Creator deletes matches"
  ON public.matches FOR DELETE TO authenticated
  USING (auth.uid() = creator_id);

CREATE TRIGGER update_matches_updated_at
  BEFORE UPDATE ON public.matches
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- HEAD-TO-HEAD helper function (security definer, respects that caller is authed)
CREATE OR REPLACE FUNCTION public.head_to_head(user_a UUID, user_b UUID)
RETURNS TABLE(matches_played BIGINT, wins_a BIGINT, wins_b BIGINT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    COUNT(*)::bigint AS matches_played,
    COUNT(*) FILTER (
      WHERE (winner = 'A' AND user_a = ANY(team_a_user_ids) AND user_b = ANY(team_b_user_ids))
         OR (winner = 'B' AND user_a = ANY(team_b_user_ids) AND user_b = ANY(team_a_user_ids))
    )::bigint AS wins_a,
    COUNT(*) FILTER (
      WHERE (winner = 'B' AND user_a = ANY(team_a_user_ids) AND user_b = ANY(team_b_user_ids))
         OR (winner = 'A' AND user_a = ANY(team_b_user_ids) AND user_b = ANY(team_a_user_ids))
    )::bigint AS wins_b
  FROM public.matches
  WHERE status = 'finished'
    AND winner IS NOT NULL
    AND ((user_a = ANY(team_a_user_ids) AND user_b = ANY(team_b_user_ids))
      OR (user_a = ANY(team_b_user_ids) AND user_b = ANY(team_a_user_ids)));
$$;

GRANT EXECUTE ON FUNCTION public.head_to_head(UUID, UUID) TO authenticated;
