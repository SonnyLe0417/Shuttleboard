import webpush from "web-push";
import { getPushConfig } from "@/lib/push-config.server";

let configured = false;
async function ensureConfigured() {
  if (configured) return;
  const { publicKey: pub, privateKey: priv, subject } = await getPushConfig();
  if (!pub || !priv) throw new Error("VAPID keys not configured");
  webpush.setVapidDetails(subject, pub, priv);
  configured = true;
}

export type PushRow = {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

export type PushPayload = {
  title: string;
  body: string;
  url?: string;
  tag?: string;
};

export async function sendToSubscription(sub: PushRow, payload: PushPayload) {
  await ensureConfigured();
  try {
    await webpush.sendNotification(
      {
        endpoint: sub.endpoint,
        keys: { p256dh: sub.p256dh, auth: sub.auth },
      },
      JSON.stringify(payload),
      { TTL: 60 * 60 * 24 },
    );
    return { ok: true as const };
  } catch (err: any) {
    return {
      ok: false as const,
      status: err?.statusCode as number | undefined,
      message: err?.body ?? err?.message ?? "push failed",
    };
  }
}

// Send to all of a user's subscriptions; disable ones that return 404/410.
export async function sendToUser(
  supabaseAdmin: any,
  userId: string,
  payload: PushPayload,
): Promise<{ sent: number; failed: number }> {
  const { data: subs } = await supabaseAdmin
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("user_id", userId)
    .eq("disabled", false);

  if (!subs?.length) return { sent: 0, failed: 0 };

  let sent = 0;
  let failed = 0;
  await Promise.all(
    subs.map(async (s: PushRow) => {
      const res = await sendToSubscription(s, payload);
      if (res.ok) {
        sent++;
        await supabaseAdmin
          .from("push_subscriptions")
          .update({ last_success_at: new Date().toISOString(), last_error: null })
          .eq("id", s.id);
      } else {
        failed++;
        const gone = res.status === 404 || res.status === 410;
        await supabaseAdmin
          .from("push_subscriptions")
          .update({
            last_error: String(res.message).slice(0, 500),
            disabled: gone,
          })
          .eq("id", s.id);
      }
    }),
  );
  return { sent, failed };
}
