-- Only trusted server code may award progress. All writes in each RPC are atomic.
CREATE OR REPLACE FUNCTION public.award_player_rewards(p_user_id uuid, p_events jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE previous_xp integer; previous_level integer; added integer; total integer; next_level integer;
BEGIN
  IF jsonb_typeof(p_events) <> 'array' OR jsonb_array_length(p_events) > 10000 THEN
    RAISE EXCEPTION 'Invalid reward batch';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_to_recordset(p_events) AS e(event_key text, kind text, xp integer)
    WHERE e.event_key IS NULL OR length(e.event_key) > 250 OR e.kind IS NULL OR e.xp IS NULL OR e.xp < 0 OR e.xp > 1000) THEN
    RAISE EXCEPTION 'Invalid reward event';
  END IF;
  INSERT INTO public.player_progress(user_id) VALUES (p_user_id) ON CONFLICT DO NOTHING;
  SELECT total_xp,current_level INTO previous_xp,previous_level FROM public.player_progress WHERE user_id=p_user_id FOR UPDATE;
  WITH inserted AS (
    INSERT INTO public.reward_events(user_id,event_key,kind,xp)
    SELECT p_user_id,e.event_key,e.kind,e.xp FROM jsonb_to_recordset(p_events) AS e(event_key text,kind text,xp integer)
    ON CONFLICT(user_id,event_key) DO NOTHING RETURNING xp
  ) SELECT coalesce(sum(xp),0) INTO added FROM inserted;
  -- Recover interrupted historical awards while preserving existing earned XP.
  SELECT greatest(previous_xp+added,coalesce(sum(xp),0)) INTO total FROM public.reward_events WHERE user_id=p_user_id;
  next_level := CASE WHEN total>=2500 THEN 8+(total-2500)/700 WHEN total>=1850 THEN 7 WHEN total>=1300 THEN 6
    WHEN total>=850 THEN 5 WHEN total>=500 THEN 4 WHEN total>=250 THEN 3 WHEN total>=100 THEN 2 ELSE 1 END;
  UPDATE public.player_progress SET total_xp=total,current_level=next_level,updated_at=now() WHERE user_id=p_user_id;
  RETURN jsonb_build_object('added_xp',added,'total_xp',total,'previous_level',previous_level,'current_level',next_level);
END $$;
REVOKE ALL ON FUNCTION public.award_player_rewards(uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.award_player_rewards(uuid,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.improve_personal_best(p_user_id uuid,p_metric_key text,p_value numeric,p_unit text,p_source_match_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE changed integer;
BEGIN
  -- Lock progress first everywhere to avoid lock-order deadlocks with reward batches.
  INSERT INTO public.player_progress(user_id) VALUES(p_user_id) ON CONFLICT DO NOTHING;
  PERFORM 1 FROM public.player_progress WHERE user_id=p_user_id FOR UPDATE;
  INSERT INTO public.personal_bests(user_id,metric_key,value,unit,source_match_id,achieved_at)
  VALUES(p_user_id,p_metric_key,p_value,p_unit,p_source_match_id,now())
  ON CONFLICT(user_id,metric_key) DO UPDATE SET value=excluded.value,unit=excluded.unit,source_match_id=excluded.source_match_id,achieved_at=excluded.achieved_at
  WHERE public.personal_bests.value < excluded.value;
  GET DIAGNOSTICS changed=ROW_COUNT;
  IF changed>0 OR EXISTS(SELECT 1 FROM public.personal_bests WHERE user_id=p_user_id AND metric_key=p_metric_key AND value=p_value) THEN
    PERFORM public.award_player_rewards(p_user_id,jsonb_build_array(jsonb_build_object(
      'event_key','personal-best:'||p_metric_key||':'||p_value::text,'kind','personalBest','xp',15)));
  END IF;
  RETURN changed>0;
END $$;
REVOKE ALL ON FUNCTION public.improve_personal_best(uuid,text,numeric,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.improve_personal_best(uuid,text,numeric,text,uuid) TO service_role;

CREATE UNIQUE INDEX IF NOT EXISTS coach_quests_period_unique ON public.coach_quests(user_id,cadence,starts_at);
ALTER TABLE public.player_insights ADD COLUMN IF NOT EXISTS stats jsonb NOT NULL DEFAULT '{}';
CREATE OR REPLACE FUNCTION public.store_player_insights(p_user_id uuid,p_insights jsonb,p_stats jsonb,p_count integer,p_generated_at timestamptz)
RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
  INSERT INTO public.player_insights(user_id,insights,stats,source_match_count,generated_at)
  VALUES(p_user_id,p_insights,p_stats,p_count,p_generated_at)
  ON CONFLICT(user_id) DO UPDATE SET insights=excluded.insights,stats=excluded.stats,source_match_count=excluded.source_match_count,generated_at=excluded.generated_at
  WHERE public.player_insights.generated_at<=excluded.generated_at;
$$;
REVOKE ALL ON FUNCTION public.store_player_insights(uuid,jsonb,jsonb,integer,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.store_player_insights(uuid,jsonb,jsonb,integer,timestamptz) TO service_role;
CREATE INDEX IF NOT EXISTS matches_team_a_lookup ON public.matches USING gin(team_a_user_ids);
CREATE INDEX IF NOT EXISTS matches_team_b_lookup ON public.matches USING gin(team_b_user_ids);
CREATE INDEX IF NOT EXISTS matches_creator_started_lookup ON public.matches(creator_id,started_at DESC);

REVOKE INSERT,UPDATE,DELETE ON public.player_progress,public.reward_events,public.player_achievements,public.personal_bests,public.coach_quests,public.player_insights FROM authenticated;
GRANT SELECT ON public.player_progress,public.reward_events,public.player_achievements,public.personal_bests,public.coach_quests,public.player_insights TO authenticated;

ALTER TABLE public.notification_events ADD COLUMN IF NOT EXISTS lease_token uuid;
ALTER TABLE public.notification_events ADD COLUMN IF NOT EXISTS leased_until timestamptz;
ALTER TABLE public.notification_events ADD COLUMN IF NOT EXISTS delivered_subscription_ids uuid[] NOT NULL DEFAULT '{}';
REVOKE INSERT,UPDATE,DELETE ON public.notification_events FROM authenticated;
CREATE OR REPLACE FUNCTION public.claim_notification_events(p_limit integer DEFAULT 20)
RETURNS SETOF public.notification_events LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
  WITH exhausted AS (
    UPDATE public.notification_events SET status='failed',last_error='Delivery retry limit reached',lease_token=NULL,leased_until=NULL
    WHERE status='pending' AND attempt_count>=6 AND (leased_until IS NULL OR leased_until<now()) RETURNING id
  )
  UPDATE public.notification_events SET lease_token=gen_random_uuid(),leased_until=now()+interval '5 minutes',attempt_count=attempt_count+1
  WHERE id IN (SELECT id FROM public.notification_events WHERE status='pending' AND available_at<=now()
    AND (leased_until IS NULL OR leased_until<now()) AND attempt_count<6
    ORDER BY available_at LIMIT least(greatest(p_limit,1),50) FOR UPDATE SKIP LOCKED)
  RETURNING *;
$$;
REVOKE ALL ON FUNCTION public.claim_notification_events(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_notification_events(integer) TO service_role;
NOTIFY pgrst, 'reload schema';

-- Credentials are in an unexposed schema, never returned by user-facing functions.
CREATE SCHEMA IF NOT EXISTS app_private;
REVOKE ALL ON SCHEMA app_private FROM PUBLIC,anon,authenticated;
GRANT USAGE ON SCHEMA app_private TO service_role;
CREATE TABLE IF NOT EXISTS app_private.notification_config (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
  project_url text NOT NULL,
  worker_token text NOT NULL,
  vapid_public_key text NOT NULL,
  vapid_private_key text NOT NULL,
  vapid_subject text NOT NULL
);
ALTER TABLE app_private.notification_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app_private.notification_config FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON app_private.notification_config TO service_role;
CREATE OR REPLACE FUNCTION public.get_notification_config() RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
  SELECT to_jsonb(c)-'singleton' FROM app_private.notification_config c WHERE singleton;
$$;
CREATE OR REPLACE FUNCTION public.initialize_notification_config(p_project_url text,p_worker_token text,p_vapid_public_key text,p_vapid_private_key text,p_vapid_subject text)
RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
  INSERT INTO app_private.notification_config(project_url,worker_token,vapid_public_key,vapid_private_key,vapid_subject)
  VALUES(p_project_url,p_worker_token,p_vapid_public_key,p_vapid_private_key,p_vapid_subject) ON CONFLICT DO NOTHING;
$$;
REVOKE ALL ON FUNCTION public.get_notification_config() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.initialize_notification_config(text,text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_notification_config() TO service_role;
GRANT EXECUTE ON FUNCTION public.initialize_notification_config(text,text,text,text,text) TO service_role;
ALTER TABLE public.notification_events DROP CONSTRAINT IF EXISTS notification_events_status_check;
ALTER TABLE public.notification_events ADD CONSTRAINT notification_events_status_check CHECK(status IN ('pending','sent','failed','skipped'));
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
SELECT cron.schedule('shuttleboard-deliver-notifications','* * * * *',$job$
  SELECT net.http_post(
    url := project_url||'/functions/v1/deliver-notifications',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||worker_token),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  ) FROM app_private.notification_config WHERE singleton;
$job$);
