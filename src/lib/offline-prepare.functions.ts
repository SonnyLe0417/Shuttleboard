import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
export const prepareOfflineScoring = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    if (context.claims.is_anonymous === true)
      throw Error("Sign in to an account to prepare offline scoring.");
    return { userId: context.userId };
  });
