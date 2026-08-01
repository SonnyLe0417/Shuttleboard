-- Settings expansion: synchronized accessibility, privacy controls, and push delivery queue.

ALTER TABLE public.user_preferences
  ADD COLUMN IF NOT EXISTS accessibility jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS public.profile_privacy (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  visibility text NOT NULL DEFAULT 'friends' CHECK (visibility IN ('friends', 'private')),
  share_achievements boolean NOT NULL DEFAULT true,
  share_streaks boolean NOT NULL DEFAULT true,
  hide_personal_bests boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.profile_privacy TO authenticated;
GRANT ALL ON public.profile_privacy TO service_role;
ALTER TABLE public.profile_privacy ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own profile privacy" ON public.profile_privacy
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER update_profile_privacy_updated_at
  BEFORE UPDATE ON public.profile_privacy
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.notification_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_key text NOT NULL,
  notification_type text NOT NULL CHECK (notification_type IN ('quest', 'level_up', 'achievement', 'reminder', 'summary', 'streak')),
  title text NOT NULL,
  body text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  available_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_error text,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, event_key)
);

CREATE INDEX IF NOT EXISTS notification_events_delivery_idx
  ON public.notification_events(status, available_at);
CREATE INDEX IF NOT EXISTS notification_events_user_idx
  ON public.notification_events(user_id, created_at DESC);

GRANT SELECT, INSERT ON public.notification_events TO authenticated;
GRANT ALL ON public.notification_events TO service_role;
ALTER TABLE public.notification_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own notification events" ON public.notification_events
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users create own notification events" ON public.notification_events
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

-- The deliver-notifications Supabase Edge Function should run on a schedule and
-- use service_role to claim pending rows, send through VAPID push, and update
-- status/attempt_count. Its deployment is intentionally separate from the app.
