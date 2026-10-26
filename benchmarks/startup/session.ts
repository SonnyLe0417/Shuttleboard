// Synthetic startup adapter, included only by the separate benchmark config.
import { createClient } from "@supabase/supabase-js";
// Exercise the same SDK initialization and transfer cost without credentials or real auth traffic.
const transport = createClient("http://127.0.0.1:1", "synthetic-not-a-credential", {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});
const session = { user: { id: "example-viewer" }, access_token: "synthetic-not-a-credential" };
const subscribers = new Set<(event: string, value: unknown) => void>();
const current = () =>
  typeof location !== "undefined" && new URLSearchParams(location.search).get("signedOut") === "1"
    ? null
    : session;
export const supabase = {
  auth: {
    async getSession() {
      await transport.auth.getSession();
      await new Promise((resolve) => setTimeout(resolve, 40));
      return { data: { session: current() }, error: null };
    },
    onAuthStateChange(callback: (event: string, value: unknown) => void) {
      subscribers.add(callback);
      const subscription = transport.auth.onAuthStateChange((event) => {
        if (subscribers.has(callback)) callback(event, current());
      });
      return {
        data: {
          subscription: {
            unsubscribe() {
              subscribers.delete(callback);
              subscription.data.subscription.unsubscribe();
            },
          },
        },
      };
    },
  },
};
