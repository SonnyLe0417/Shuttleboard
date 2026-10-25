import { createMiddleware } from "@tanstack/react-start";
import { loadBrowserSupabase } from "./browser-supabase";
import { getPublicProfile } from "./growth.functions";

// Retrieve the current token for every RPC; defer SDK transfer until a session consumer needs it.
export const attachSupabaseAuth = createMiddleware({ type: "function" }).client(
  async ({ next, serverFnMeta }) => {
    // This read already permits anonymous access and must survive auth-module failure.
    // Match the compiled function ID, never the page URL or caller-controlled data.
    if (getPublicProfile.url.endsWith(`/${serverFnMeta.id}`)) return next();
    const supabase = await loadBrowserSupabase();
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    return next({ headers: token ? { Authorization: `Bearer ${token}` } : {} });
  },
);
