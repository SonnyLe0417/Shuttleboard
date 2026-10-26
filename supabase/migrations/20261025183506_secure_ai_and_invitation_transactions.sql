-- Server-only admissions. No user-controlled actor or quota can reach these RPCs.
CREATE SCHEMA IF NOT EXISTS app_private;
CREATE TABLE app_private.ai_vision_days (
  day date PRIMARY KEY, used integer NOT NULL DEFAULT 0 CHECK (used >= 0)
);
CREATE TABLE app_private.ai_vision_users (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  day date NOT NULL, minute timestamptz NOT NULL,
  day_used integer NOT NULL DEFAULT 0 CHECK (day_used >= 0),
  minute_used integer NOT NULL DEFAULT 0 CHECK (minute_used >= 0),
  lease_id uuid, lease_until timestamptz
);
ALTER TABLE app_private.ai_vision_days ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_private.ai_vision_users ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app_private.ai_vision_days, app_private.ai_vision_users FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA app_private TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON app_private.ai_vision_days, app_private.ai_vision_users TO service_role;

CREATE FUNCTION public.reserve_ai_vision(p_user_id uuid,p_minute_limit integer,p_day_limit integer,p_global_limit integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE
  t timestamptz := now(); d date := (now() AT TIME ZONE 'UTC')::date;
  m timestamptz := date_trunc('minute',now());
  retry_day integer := greatest(1,ceil(extract(epoch FROM (((((now() AT TIME ZONE 'UTC')::date)+1)::timestamp AT TIME ZONE 'UTC')-now())))::integer);
  u app_private.ai_vision_users; g integer; lease uuid;
BEGIN
  IF p_user_id IS NULL OR p_minute_limit IS NULL OR p_day_limit IS NULL OR p_global_limit IS NULL
    OR least(p_minute_limit,p_day_limit,p_global_limit)<1 THEN RAISE EXCEPTION 'Invalid quota configuration'; END IF;
  INSERT INTO app_private.ai_vision_days(day) VALUES(d) ON CONFLICT DO NOTHING;
  SELECT used INTO g FROM app_private.ai_vision_days WHERE day=d FOR UPDATE;
  INSERT INTO app_private.ai_vision_users(user_id,day,minute) VALUES(p_user_id,d,m) ON CONFLICT DO NOTHING;
  SELECT * INTO u FROM app_private.ai_vision_users WHERE user_id=p_user_id FOR UPDATE;
  IF u.day<>d THEN u.day_used:=0; END IF;
  IF u.minute<>m THEN u.minute_used:=0; END IF;
  IF g>=p_global_limit THEN RETURN jsonb_build_object('allowed',false,'code','global_limit','retry_after',retry_day); END IF;
  IF u.day_used>=p_day_limit THEN RETURN jsonb_build_object('allowed',false,'code','day_limit','retry_after',retry_day); END IF;
  IF u.minute_used>=p_minute_limit THEN RETURN jsonb_build_object('allowed',false,'code','minute_limit','retry_after',greatest(1,ceil(extract(epoch FROM (m+interval '1 minute'-t)))::integer)); END IF;
  IF u.lease_until>t THEN RETURN jsonb_build_object('allowed',false,'code','request_in_progress','retry_after',greatest(1,ceil(extract(epoch FROM (u.lease_until-t)))::integer)); END IF;
  lease:=gen_random_uuid();
  UPDATE app_private.ai_vision_days SET used=used+1 WHERE day=d;
  UPDATE app_private.ai_vision_users SET day=d,minute=m,day_used=u.day_used+1,minute_used=u.minute_used+1,
    lease_id=lease,lease_until=t+interval '60 seconds' WHERE user_id=p_user_id;
  DELETE FROM app_private.ai_vision_days WHERE day<d-7;
  RETURN jsonb_build_object('allowed',true,'lease_id',lease);
END $$;
CREATE FUNCTION public.release_ai_vision(p_user_id uuid,p_lease_id uuid)
RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
  UPDATE app_private.ai_vision_users SET lease_id=NULL,lease_until=NULL
  WHERE user_id=p_user_id AND lease_id=p_lease_id;
$$;
REVOKE ALL ON FUNCTION public.reserve_ai_vision(uuid,integer,integer,integer),public.release_ai_vision(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_ai_vision(uuid,integer,integer,integer),public.release_ai_vision(uuid,uuid) TO service_role;

-- Keep player access to matches narrow. Only the authenticated server may enroll.
CREATE FUNCTION public.respond_to_match_invite(p_actor_id uuid,p_invite_id uuid DEFAULT NULL,p_token_hash text DEFAULT NULL,p_accept boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE i public.match_invites; m public.matches; target uuid[]; opposite uuid[]; capacity integer;
BEGIN
  IF p_actor_id IS NULL OR p_accept IS NULL OR (p_invite_id IS NULL)=(p_token_hash IS NULL) THEN RAISE EXCEPTION 'Invalid invitation request'; END IF;
  SELECT * INTO i FROM public.match_invites WHERE
    (p_invite_id IS NOT NULL AND id=p_invite_id) OR (p_token_hash IS NOT NULL AND token_hash=p_token_hash);
  IF NOT FOUND THEN RAISE EXCEPTION 'This invitation is no longer available.'; END IF;
  -- Match first for every operation, including decline, to avoid lock-order cycles.
  SELECT * INTO m FROM public.matches WHERE id=i.match_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'This invitation is no longer available.'; END IF;
  SELECT * INTO i FROM public.match_invites WHERE id=i.id AND match_id=m.id FOR UPDATE;
  IF NOT FOUND OR i.sender_id<>m.creator_id OR m.status='abandoned' THEN RAISE EXCEPTION 'This invitation is no longer available.'; END IF;
  IF (p_invite_id IS NOT NULL AND i.recipient_id IS DISTINCT FROM p_actor_id)
    OR (p_token_hash IS NOT NULL AND (i.token_hash IS DISTINCT FROM p_token_hash OR (i.recipient_id IS NOT NULL AND i.recipient_id<>p_actor_id)))
    THEN RAISE EXCEPTION 'This invitation is not addressed to you.'; END IF;
  IF i.recipient_id=p_actor_id AND ((p_accept AND i.status='accepted') OR (NOT p_accept AND i.status='declined')) THEN
    RETURN jsonb_build_object('ok',true,'accepted',p_accept,'match_id',m.id);
  END IF;
  IF i.status<>'pending' OR i.expires_at<=now() THEN RAISE EXCEPTION 'This invitation is no longer available.'; END IF;
  IF p_accept THEN
    target:=coalesce(CASE WHEN i.team_side='A' THEN m.team_a_user_ids ELSE m.team_b_user_ids END,'{}'::uuid[]);
    opposite:=coalesce(CASE WHEN i.team_side='A' THEN m.team_b_user_ids ELSE m.team_a_user_ids END,'{}'::uuid[]);
    IF p_actor_id=ANY(opposite) THEN RAISE EXCEPTION 'You already belong to the other team.'; END IF;
    capacity:=CASE WHEN m.mode='singles' THEN 1 ELSE 2 END;
    IF NOT p_actor_id=ANY(target) THEN
      IF cardinality(target)>=capacity THEN RAISE EXCEPTION 'That team is full.'; END IF;
      IF i.team_side='A' THEN UPDATE public.matches SET team_a_user_ids=array_append(target,p_actor_id) WHERE id=m.id;
      ELSE UPDATE public.matches SET team_b_user_ids=array_append(target,p_actor_id) WHERE id=m.id; END IF;
      IF NOT FOUND THEN RAISE EXCEPTION 'Match membership was not updated.'; END IF;
    END IF;
    UPDATE public.match_invites SET status='accepted',recipient_id=p_actor_id,accepted_at=now() WHERE id=i.id;
  ELSE
    UPDATE public.match_invites SET status='declined' WHERE id=i.id;
  END IF;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invitation was not updated.'; END IF;
  RETURN jsonb_build_object('ok',true,'accepted',p_accept,'match_id',m.id);
END $$;
REVOKE ALL ON FUNCTION public.respond_to_match_invite(uuid,uuid,text,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.respond_to_match_invite(uuid,uuid,text,boolean) TO service_role;
REVOKE UPDATE ON public.match_invites FROM PUBLIC,anon,authenticated;
DROP POLICY "Invite participants update invites" ON public.match_invites;
DROP POLICY "Users create own invites" ON public.match_invites;
CREATE POLICY "Creators create pending invites" ON public.match_invites FOR INSERT TO authenticated
WITH CHECK (
  sender_id=(SELECT auth.uid()) AND status='pending' AND accepted_at IS NULL
  AND expires_at>now() AND expires_at<=now()+interval '7 days'
  AND (recipient_id IS NOT NULL OR token_hash IS NOT NULL)
  AND (token_hash IS NULL OR token_hash ~ '^[a-f0-9]{64}$')
  AND EXISTS(SELECT 1 FROM public.matches m WHERE m.id=match_id AND m.creator_id=(SELECT auth.uid()) AND m.status<>'abandoned')
);
CREATE INDEX IF NOT EXISTS direct_messages_cursor_idx ON public.direct_messages(sender_id,recipient_id,created_at,id);
CREATE INDEX IF NOT EXISTS group_messages_cursor_idx ON public.group_messages(group_id,created_at,id);
