import { timingSafeEqual } from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
export async function authorizeNotificationWorker(token: string, db: any = supabaseAdmin) {
  const { data, error } = await db.rpc("get_notification_config");
  if (error || typeof data?.worker_token !== "string" || !data.worker_token)
    return new Response("Notification worker is not configured", { status: 503 });
  const encoder = new TextEncoder(),
    a = encoder.encode(token),
    b = encoder.encode(data.worker_token);
  if (a.length !== b.length || !timingSafeEqual(a, b))
    return new Response("Unauthorized", { status: 401 });
  return true;
}
