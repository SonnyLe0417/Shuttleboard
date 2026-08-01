
-- head_to_head: switch to SECURITY INVOKER so RLS on matches applies naturally
CREATE OR REPLACE FUNCTION public.head_to_head(user_a UUID, user_b UUID)
RETURNS TABLE(matches_played BIGINT, wins_a BIGINT, wins_b BIGINT)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT
    COUNT(*)::bigint,
    COUNT(*) FILTER (
      WHERE (winner = 'A' AND user_a = ANY(team_a_user_ids) AND user_b = ANY(team_b_user_ids))
         OR (winner = 'B' AND user_a = ANY(team_b_user_ids) AND user_b = ANY(team_a_user_ids))
    )::bigint,
    COUNT(*) FILTER (
      WHERE (winner = 'B' AND user_a = ANY(team_a_user_ids) AND user_b = ANY(team_b_user_ids))
         OR (winner = 'A' AND user_a = ANY(team_b_user_ids) AND user_b = ANY(team_a_user_ids))
    )::bigint
  FROM public.matches
  WHERE status = 'finished'
    AND winner IS NOT NULL
    AND ((user_a = ANY(team_a_user_ids) AND user_b = ANY(team_b_user_ids))
      OR (user_a = ANY(team_b_user_ids) AND user_b = ANY(team_a_user_ids)));
$$;

-- Lock down trigger fn — only the trigger context needs it
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_updated_at_column() FROM PUBLIC, anon, authenticated;
