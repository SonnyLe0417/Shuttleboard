
CREATE TABLE public.push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint text NOT NULL UNIQUE,
  p256dh text NOT NULL,
  auth text NOT NULL,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_success_at timestamptz,
  last_error text,
  disabled boolean NOT NULL DEFAULT false
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.push_subscriptions TO authenticated;
GRANT ALL ON public.push_subscriptions TO service_role;

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own subscriptions"
ON public.push_subscriptions FOR ALL
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE INDEX push_subscriptions_user_id_idx ON public.push_subscriptions(user_id);

-- Track when we last sent each type of notification per user, to prevent duplicates
CREATE TABLE public.notification_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind text NOT NULL, -- 'reminder_daily' | 'reminder_inactivity' | 'weekly_summary' | 'streak_alert'
  bucket text NOT NULL, -- dedupe key, e.g. '2026-07-15' or '2026-W28' or streak count
  sent_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, kind, bucket)
);

GRANT SELECT ON public.notification_log TO authenticated;
GRANT ALL ON public.notification_log TO service_role;

ALTER TABLE public.notification_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own notification log"
ON public.notification_log FOR SELECT
TO authenticated
USING (auth.uid() = user_id);
