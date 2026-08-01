-- Growth features: public cards, match invites, and referrals.
ALTER TABLE public.user_preferences
  ADD COLUMN IF NOT EXISTS public_profile_enabled boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.match_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id uuid NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  recipient_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  token_hash text UNIQUE,
  team_side text NOT NULL CHECK (team_side IN ('A', 'B')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'revoked', 'expired')),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS match_invites_recipient_idx ON public.match_invites(recipient_id, status);
CREATE INDEX IF NOT EXISTS match_invites_sender_idx ON public.match_invites(sender_id, status);

GRANT SELECT, INSERT, UPDATE ON public.match_invites TO authenticated;
GRANT ALL ON public.match_invites TO service_role;
ALTER TABLE public.match_invites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Invite participants can view invites" ON public.match_invites
  FOR SELECT TO authenticated USING (auth.uid() = sender_id OR auth.uid() = recipient_id);
CREATE POLICY "Users create own invites" ON public.match_invites
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = sender_id);
CREATE POLICY "Invite participants update invites" ON public.match_invites
  FOR UPDATE TO authenticated USING (auth.uid() = sender_id OR auth.uid() = recipient_id)
  WITH CHECK (auth.uid() = sender_id OR auth.uid() = recipient_id);

CREATE TRIGGER update_match_invites_updated_at
  BEFORE UPDATE ON public.match_invites
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS referral_code text UNIQUE;

UPDATE public.profiles
SET referral_code = lower(handle) || '-' || substr(replace(id::text, '-', ''), 1, 8)
WHERE referral_code IS NULL;

ALTER TABLE public.profiles
  ALTER COLUMN referral_code DROP DEFAULT;

CREATE OR REPLACE FUNCTION public.ensure_referral_code()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.referral_code IS NULL OR NEW.referral_code = '' THEN
    NEW.referral_code := lower(NEW.handle) || '-' || substr(replace(NEW.id::text, '-', ''), 1, 8);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ensure_profile_referral_code ON public.profiles;
CREATE TRIGGER ensure_profile_referral_code
  BEFORE INSERT OR UPDATE OF handle ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.ensure_referral_code();

CREATE TABLE IF NOT EXISTS public.referrals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  referred_id uuid UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  referral_code text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'rejected')),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (referrer_id, referral_code, referred_id)
);

CREATE INDEX IF NOT EXISTS referrals_referrer_idx ON public.referrals(referrer_id, status);
CREATE INDEX IF NOT EXISTS referrals_code_idx ON public.referrals(referral_code);
GRANT SELECT, INSERT, UPDATE ON public.referrals TO authenticated;
GRANT ALL ON public.referrals TO service_role;
ALTER TABLE public.referrals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own referrals" ON public.referrals FOR SELECT TO authenticated
  USING (auth.uid() = referrer_id OR auth.uid() = referred_id);
CREATE POLICY "Users create referral attribution" ON public.referrals FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = referred_id);
CREATE POLICY "Referral participants update" ON public.referrals FOR UPDATE TO authenticated
  USING (auth.uid() = referrer_id OR auth.uid() = referred_id)
  WITH CHECK (auth.uid() = referrer_id OR auth.uid() = referred_id);
