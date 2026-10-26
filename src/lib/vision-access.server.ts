import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const VISION_BODY_LIMIT = 2 * 1024 * 1024;
export function visionError(status: number, code: string, error: string, retryAfter?: number) {
  return Response.json(
    { error, code },
    {
      status,
      headers: {
        "cache-control": "no-store",
        ...(retryAfter ? { "retry-after": String(Math.max(1, Math.ceil(retryAfter))) } : {}),
      },
    },
  );
}
export async function authenticateVision(request: Request, verify = verifyVisionToken) {
  const token = /^Bearer ([^\s,]+)$/i.exec(request.headers.get("authorization") ?? "")?.[1];
  if (!token) return visionError(401, "sign_in_required", "Sign in to use paid AI analysis.");
  try {
    const userId = await verify(token);
    return userId || visionError(401, "sign_in_required", "Sign in again to use paid AI analysis.");
  } catch {
    return visionError(
      503,
      "auth_unavailable",
      "Sign-in verification is unavailable. Paid AI is paused.",
    );
  }
}
async function verifyVisionToken(token: string) {
  const url = process.env.SUPABASE_URL,
    key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw Error("Auth configuration unavailable");
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data, error } = await client.auth.getClaims(token);
  if (error || !data?.claims) return null;
  const claims = data.claims;
  return typeof claims.sub === "string" &&
    claims.role === "authenticated" &&
    claims.is_anonymous !== true &&
    typeof claims.exp === "number" &&
    claims.exp * 1000 > Date.now()
    ? claims.sub
    : null;
}
export async function readVisionBody(request: Request) {
  if (Number(request.headers.get("content-length")) > VISION_BODY_LIMIT)
    return visionError(413, "image_too_large", "AI requests must be at most 2 MiB.");
  const reader = request.body?.getReader();
  if (!reader) return visionError(400, "invalid_input", "An image request is required.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > VISION_BODY_LIMIT) {
        await reader.cancel();
        return visionError(413, "image_too_large", "AI requests must be at most 2 MiB.");
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    return visionError(400, "invalid_input", "The AI request is not valid JSON.");
  } finally {
    reader.releaseLock();
  }
}
function limit(name: string, fallback: number) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value < 1 || value > 2147483647)
    throw Error("Invalid AI limit");
  return value;
}
export async function reserveVision(userId: string, db: any = supabaseAdmin) {
  try {
    const { data, error } = await db.rpc("reserve_ai_vision", {
      p_user_id: userId,
      p_minute_limit: limit("AI_VISION_USER_MINUTE_LIMIT", 60),
      p_day_limit: limit("AI_VISION_USER_DAY_LIMIT", 1000),
      p_global_limit: limit("AI_VISION_GLOBAL_DAY_LIMIT", 10000),
    });
    if (error || !data) throw Error("Quota unavailable");
    if (data.allowed !== true) {
      if (
        !["minute_limit", "day_limit", "global_limit", "request_in_progress"].includes(data.code) ||
        !Number.isFinite(data.retry_after)
      )
        throw Error("Invalid quota result");
      return visionError(
        429,
        data.code,
        data.code === "request_in_progress"
          ? "Another paid AI request is running for this account."
          : "Paid AI usage limit reached. Local tracking and manual scoring remain available.",
        data.retry_after,
      );
    }
    if (typeof data.lease_id !== "string") throw Error("Invalid reservation");
    return {
      release: async () => {
        try {
          const result = await db.rpc("release_ai_vision", {
            p_user_id: userId,
            p_lease_id: data.lease_id,
          });
          if (result.error) throw Error();
        } catch {
          console.error("AI reservation release failed; lease will expire.");
        }
      },
    };
  } catch {
    return visionError(
      503,
      "quota_unavailable",
      "Usage verification is unavailable. Paid AI is paused.",
    );
  }
}
