
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS bio text,
  ADD COLUMN IF NOT EXISTS location text,
  ADD COLUMN IF NOT EXISTS playing_hand text,
  ADD COLUMN IF NOT EXISTS favorite_racket text,
  ADD COLUMN IF NOT EXISTS home_court text;

CREATE TABLE IF NOT EXISTS public.user_preferences (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  match_defaults jsonb NOT NULL DEFAULT '{}'::jsonb,
  dashboard jsonb NOT NULL DEFAULT '{}'::jsonb,
  notifications jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_preferences TO authenticated;
GRANT ALL ON public.user_preferences TO service_role;

ALTER TABLE public.user_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own preferences" ON public.user_preferences
  FOR SELECT TO authenticated USING (auth.uid() = id);
CREATE POLICY "Users insert own preferences" ON public.user_preferences
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);
CREATE POLICY "Users update own preferences" ON public.user_preferences
  FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
CREATE POLICY "Users delete own preferences" ON public.user_preferences
  FOR DELETE TO authenticated USING (auth.uid() = id);

CREATE TRIGGER update_user_preferences_updated_at
  BEFORE UPDATE ON public.user_preferences
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.matches
  ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS opponent_nicknames jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Avatars bucket storage policies (bucket already created)
CREATE POLICY "Avatars readable by authenticated" ON storage.objects
  FOR SELECT TO authenticated USING (bucket_id = 'avatars');
CREATE POLICY "Users upload own avatar" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "Users update own avatar" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "Users delete own avatar" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);
