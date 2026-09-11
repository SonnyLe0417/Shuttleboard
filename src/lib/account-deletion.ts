/** Claims must have been signature-verified by the server middleware. Token refresh is not reauthentication. */
export function hasRecentOAuthAuthentication(
  claims: Record<string, unknown>,
  nowSeconds = Date.now() / 1000,
) {
  const methods = Array.isArray(claims.amr) ? claims.amr : [];
  return methods.some((entry) => {
    if (!entry || typeof entry !== "object") return false;
    const { method, timestamp } = entry as { method?: string; timestamp?: number };
    return (
      method === "oauth" &&
      typeof timestamp === "number" &&
      timestamp <= nowSeconds + 30 &&
      nowSeconds - timestamp <= 300
    );
  });
}

export async function authorizeAccountDeletion(input: {
  userId: string;
  user: { id: string; email?: string; identities?: Array<{ provider: string }> } | null;
  claims: Record<string, unknown>;
  password?: string;
  verifyPassword: (email: string, password: string) => Promise<string | null>;
}) {
  if (!input.user || input.user.id !== input.userId || input.claims.sub !== input.userId)
    throw new Error("Your session is no longer valid. Sign in again.");
  if (input.password && input.user.email) {
    const verifiedId = await input.verifyPassword(input.user.email, input.password);
    if (verifiedId !== input.userId)
      throw new Error("Your current password could not be verified.");
    return;
  }
  if (
    input.user.identities?.some((i) => i.provider === "google") &&
    hasRecentOAuthAuthentication(input.claims)
  )
    return;
  throw new Error(
    "Reauthenticate before deleting: enter your current password or sign in again with Google within five minutes.",
  );
}
