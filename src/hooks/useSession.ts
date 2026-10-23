import { useSyncExternalStore } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { createSessionStore } from "@/lib/session-store";

const store = createSessionStore<Session>((publish) => {
  // INITIAL_SESSION supplies the stored session after SDK initialization.
  // Subsequent events keep every consumer current, including across tabs.
  const { data } = supabase.auth.onAuthStateChange((_event, session) => publish(session));
  return () => data.subscription.unsubscribe();
});

export function useSession() {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
}
