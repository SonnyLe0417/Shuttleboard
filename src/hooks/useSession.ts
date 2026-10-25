import { useSyncExternalStore } from "react";
import type { Session } from "@supabase/supabase-js";
import { loadBrowserSupabase } from "@/lib/browser-supabase";
import { deferredSubscription } from "@/lib/deferred-subscription";
import { createSessionStore } from "@/lib/session-store";

const store = createSessionStore<Session>((publish, fail) => {
  // INITIAL_SESSION supplies the stored session after SDK initialization.
  // Subsequent events keep every consumer current, including across tabs.
  return deferredSubscription(
    loadBrowserSupabase(),
    (supabase) => {
      const { data } = supabase.auth.onAuthStateChange((_event, session) => publish(session));
      return () => data.subscription.unsubscribe();
    },
    fail,
  );
});

export function useSession() {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
}
