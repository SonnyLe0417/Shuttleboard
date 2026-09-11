import { createClient } from "@supabase/supabase-js";
import { getRequest } from "@tanstack/react-start/server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { authorizeAccountDeletion } from "@/lib/account-deletion";

export async function deleteAuthenticatedAccount(
  context: { userId: string; claims: Record<string, unknown>; supabase: any },
  password?: string,
) {
  const token = getRequest().headers.get("authorization")?.slice(7);
  if (!token) throw new Error("Sign in again before deleting your account.");
  // Check the live Auth user, not only the cached JWT signature.
  const { data, error } = await context.supabase.auth.getUser(token);
  if (error) throw new Error("Your session is no longer valid. Sign in again.");
  await authorizeAccountDeletion({
    userId: context.userId,
    user: data.user,
    claims: context.claims,
    password,
    verifyPassword: async (email, currentPassword) => {
      const verifier = createClient(
        process.env.SUPABASE_URL!,
        process.env.SUPABASE_PUBLISHABLE_KEY!,
        {
          auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
        },
      );
      const verified = await verifier.auth.signInWithPassword({ email, password: currentPassword });
      if (verified.error) return null;
      const id = verified.data.user?.id ?? null;
      await verifier.auth.signOut({ scope: "local" });
      return id;
    },
  });
  const { error: signOutError } = await supabaseAdmin.auth.admin.signOut(token, "global");
  if (signOutError) throw new Error("Couldn't revoke your sessions. Please try again.");
  const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(context.userId);
  if (deleteError) throw new Error(deleteError.message);
  return { ok: true as const };
}
