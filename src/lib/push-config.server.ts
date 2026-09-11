import { supabaseAdmin } from "@/integrations/supabase/client.server";

let cached: { publicKey: string; privateKey: string; subject: string } | undefined;
export async function getPushConfig() {
  if (cached) return cached;
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    cached = {
      publicKey: process.env.VAPID_PUBLIC_KEY,
      privateKey: process.env.VAPID_PRIVATE_KEY,
      subject: process.env.VAPID_SUBJECT ?? "mailto:notifications@shuttleboard.app",
    };
  } else {
    const { data, error } = await (supabaseAdmin as any).rpc("get_notification_config");
    if (error || !data) throw new Error("Push notifications are not configured yet.");
    cached = {
      publicKey: data.vapid_public_key,
      privateKey: data.vapid_private_key,
      subject: data.vapid_subject,
    };
  }
  return cached;
}
