-- Group chats
CREATE TABLE public.chat_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL CHECK (length(btrim(name)) > 0 AND length(name) <= 80),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.chat_group_members (
  group_id UUID NOT NULL REFERENCES public.chat_groups(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member')),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, user_id)
);

CREATE TABLE public.group_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES public.chat_groups(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body TEXT NOT NULL CHECK (length(btrim(body)) > 0 AND length(body) <= 2000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX chat_group_members_user_idx ON public.chat_group_members(user_id);
CREATE INDEX group_messages_group_idx ON public.group_messages(group_id, created_at ASC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.chat_groups TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.chat_group_members TO authenticated;
GRANT SELECT, INSERT ON public.group_messages TO authenticated;
GRANT ALL ON public.chat_groups, public.chat_group_members, public.group_messages TO service_role;

ALTER TABLE public.chat_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_messages ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_chat_group_member(target_group_id UUID, target_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.chat_group_members
    WHERE group_id = target_group_id AND user_id = target_user_id
  );
$$;

CREATE POLICY "Members can view groups"
ON public.chat_groups FOR SELECT TO authenticated
USING (
  owner_id = auth.uid()
  OR public.is_chat_group_member(id, auth.uid())
);

CREATE POLICY "Users can create groups"
ON public.chat_groups FOR INSERT TO authenticated
WITH CHECK (owner_id = auth.uid());

CREATE POLICY "Owners can update groups"
ON public.chat_groups FOR UPDATE TO authenticated
USING (owner_id = auth.uid())
WITH CHECK (owner_id = auth.uid());

CREATE POLICY "Owners can delete groups"
ON public.chat_groups FOR DELETE TO authenticated
USING (owner_id = auth.uid());

CREATE POLICY "Members can view group members"
ON public.chat_group_members FOR SELECT TO authenticated
USING (
  user_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM public.chat_groups g
    WHERE g.id = group_id AND g.owner_id = auth.uid()
  )
  OR public.is_chat_group_member(group_id, auth.uid())
);

CREATE POLICY "Owners can add group members"
ON public.chat_group_members FOR INSERT TO authenticated
WITH CHECK (
  user_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM public.chat_groups g
    WHERE g.id = group_id AND g.owner_id = auth.uid()
  )
);

CREATE POLICY "Owners can remove group members"
ON public.chat_group_members FOR DELETE TO authenticated
USING (
  user_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM public.chat_groups g
    WHERE g.id = group_id AND g.owner_id = auth.uid()
  )
);

CREATE POLICY "Members can view group messages"
ON public.group_messages FOR SELECT TO authenticated
USING (
  public.is_chat_group_member(group_id, auth.uid())
);

CREATE POLICY "Members can send group messages"
ON public.group_messages FOR INSERT TO authenticated
WITH CHECK (
  sender_id = auth.uid()
  AND public.is_chat_group_member(group_id, auth.uid())
);
