type BrowserSupabase = typeof import("@/integrations/supabase/client").supabase;
let pending: Promise<BrowserSupabase> | undefined;

/** Share module loading, not authentication state: callers still retrieve the current session. */
export function loadBrowserSupabase(): Promise<BrowserSupabase> {
  return (pending ??= import("@/integrations/supabase/client")
    .then((module) => module.supabase)
    .catch((error) => {
      pending = undefined;
      const failure = new Error("The sign-in module could not load", { cause: error });
      failure.name = "SessionLoadError";
      throw failure;
    }));
}
