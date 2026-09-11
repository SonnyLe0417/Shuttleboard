-- Complete verified missing feature schema without guessing categories for old matches.
ALTER TABLE public.matches
  ADD COLUMN IF NOT EXISTS category text,
  ADD COLUMN IF NOT EXISTS title text,
  ADD COLUMN IF NOT EXISTS court_name text;
ALTER TABLE public.matches DROP CONSTRAINT IF EXISTS matches_category_check;
ALTER TABLE public.matches ADD CONSTRAINT matches_category_check CHECK(category IN ('mens-singles','womens-singles','mens-doubles','womens-doubles','mixed-doubles'));
CREATE INDEX IF NOT EXISTS matches_category_idx ON public.matches(category);

CREATE TABLE IF NOT EXISTS public.chat_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK(length(btrim(name))>0 AND length(name)<=80),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.chat_group_members (
  group_id uuid NOT NULL REFERENCES public.chat_groups(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member' CHECK(role IN ('owner','member')),
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(group_id,user_id)
);
CREATE TABLE IF NOT EXISTS public.group_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES public.chat_groups(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body text NOT NULL CHECK(length(btrim(body))>0 AND length(body)<=2000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS chat_group_members_user_idx ON public.chat_group_members(user_id);
CREATE INDEX IF NOT EXISTS group_messages_group_idx ON public.group_messages(group_id,created_at);
CREATE INDEX IF NOT EXISTS group_messages_sender_idx ON public.group_messages(sender_id);
CREATE INDEX IF NOT EXISTS chat_groups_owner_idx ON public.chat_groups(owner_id);
ALTER TABLE public.chat_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_messages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.chat_groups,public.chat_group_members,public.group_messages FROM anon;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.chat_groups TO authenticated;
REVOKE INSERT,UPDATE ON public.chat_group_members FROM authenticated;
GRANT SELECT,DELETE ON public.chat_group_members TO authenticated;
GRANT SELECT,INSERT ON public.group_messages TO authenticated;
GRANT ALL ON public.chat_groups,public.chat_group_members,public.group_messages TO service_role;

DROP POLICY IF EXISTS "Members can view group members" ON public.chat_group_members;
DROP POLICY IF EXISTS "Owners can add group members" ON public.chat_group_members;
DROP POLICY IF EXISTS "Owners can remove group members" ON public.chat_group_members;
CREATE POLICY "Members can view group members" ON public.chat_group_members FOR SELECT TO authenticated USING(user_id=(select auth.uid()));
CREATE POLICY "Owners can remove group members" ON public.chat_group_members FOR DELETE TO authenticated USING(user_id=(select auth.uid()));
-- Full rosters and membership creation use authenticated server functions after ownership/friend checks.
DROP POLICY IF EXISTS "Members can view groups" ON public.chat_groups;
DROP POLICY IF EXISTS "Users can create groups" ON public.chat_groups;
DROP POLICY IF EXISTS "Owners can update groups" ON public.chat_groups;
DROP POLICY IF EXISTS "Owners can delete groups" ON public.chat_groups;
CREATE POLICY "Members can view groups" ON public.chat_groups FOR SELECT TO authenticated USING(
  owner_id=(select auth.uid()) OR EXISTS(SELECT 1 FROM public.chat_group_members m WHERE m.group_id=chat_groups.id AND m.user_id=(select auth.uid()))
);
CREATE POLICY "Users can create groups" ON public.chat_groups FOR INSERT TO authenticated WITH CHECK(owner_id=(select auth.uid()));
CREATE POLICY "Owners can update groups" ON public.chat_groups FOR UPDATE TO authenticated USING(owner_id=(select auth.uid())) WITH CHECK(owner_id=(select auth.uid()));
CREATE POLICY "Owners can delete groups" ON public.chat_groups FOR DELETE TO authenticated USING(owner_id=(select auth.uid()));
DROP POLICY IF EXISTS "Members can view group messages" ON public.group_messages;
DROP POLICY IF EXISTS "Members can send group messages" ON public.group_messages;
CREATE POLICY "Members can view group messages" ON public.group_messages FOR SELECT TO authenticated USING(
  EXISTS(SELECT 1 FROM public.chat_group_members m WHERE m.group_id=group_messages.group_id AND m.user_id=(select auth.uid()))
);
CREATE POLICY "Members can send group messages" ON public.group_messages FOR INSERT TO authenticated WITH CHECK(
  sender_id=(select auth.uid()) AND EXISTS(SELECT 1 FROM public.chat_group_members m WHERE m.group_id=group_messages.group_id AND m.user_id=(select auth.uid()))
);
DROP FUNCTION IF EXISTS public.is_chat_group_member(uuid,uuid);
NOTIFY pgrst,'reload schema';
