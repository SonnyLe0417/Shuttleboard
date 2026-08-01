
-- Friendships
CREATE TYPE public.friendship_status AS ENUM ('pending', 'accepted', 'blocked');

CREATE TABLE public.friendships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  addressee_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status public.friendship_status NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT friendships_no_self CHECK (requester_id <> addressee_id),
  CONSTRAINT friendships_unique_pair UNIQUE (requester_id, addressee_id)
);

CREATE INDEX friendships_requester_idx ON public.friendships(requester_id);
CREATE INDEX friendships_addressee_idx ON public.friendships(addressee_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.friendships TO authenticated;
GRANT ALL ON public.friendships TO service_role;

ALTER TABLE public.friendships ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their friendships"
ON public.friendships FOR SELECT TO authenticated
USING (auth.uid() = requester_id OR auth.uid() = addressee_id);

CREATE POLICY "Users can send friend requests"
ON public.friendships FOR INSERT TO authenticated
WITH CHECK (auth.uid() = requester_id);

CREATE POLICY "Participants can update friendship"
ON public.friendships FOR UPDATE TO authenticated
USING (auth.uid() = requester_id OR auth.uid() = addressee_id)
WITH CHECK (auth.uid() = requester_id OR auth.uid() = addressee_id);

CREATE POLICY "Participants can remove friendship"
ON public.friendships FOR DELETE TO authenticated
USING (auth.uid() = requester_id OR auth.uid() = addressee_id);

CREATE TRIGGER update_friendships_updated_at
BEFORE UPDATE ON public.friendships
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Direct Messages
CREATE TABLE public.direct_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  recipient_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body TEXT NOT NULL CHECK (length(btrim(body)) > 0 AND length(body) <= 2000),
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT direct_messages_no_self CHECK (sender_id <> recipient_id)
);

CREATE INDEX direct_messages_pair_idx
  ON public.direct_messages(least(sender_id, recipient_id), greatest(sender_id, recipient_id), created_at DESC);
CREATE INDEX direct_messages_recipient_unread_idx
  ON public.direct_messages(recipient_id) WHERE read_at IS NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.direct_messages TO authenticated;
GRANT ALL ON public.direct_messages TO service_role;

ALTER TABLE public.direct_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Participants can read messages"
ON public.direct_messages FOR SELECT TO authenticated
USING (auth.uid() = sender_id OR auth.uid() = recipient_id);

CREATE POLICY "Sender can create message"
ON public.direct_messages FOR INSERT TO authenticated
WITH CHECK (
  auth.uid() = sender_id
  AND EXISTS (
    SELECT 1 FROM public.friendships f
    WHERE f.status = 'accepted'
      AND (
        (f.requester_id = auth.uid() AND f.addressee_id = recipient_id) OR
        (f.addressee_id = auth.uid() AND f.requester_id = recipient_id)
      )
  )
);

CREATE POLICY "Recipient can mark read"
ON public.direct_messages FOR UPDATE TO authenticated
USING (auth.uid() = recipient_id)
WITH CHECK (auth.uid() = recipient_id);
