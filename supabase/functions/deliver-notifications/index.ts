import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";
import { timingSafeEqual } from "node:crypto";
import {
  nextAllowedNotificationAt,
  notificationEnabled,
} from "../_shared/notification-schedule.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);
const encoder = new TextEncoder();
function equalSecret(left: string, right: string) {
  const a = encoder.encode(left),
    b = encoder.encode(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const authorization = request.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) return new Response("Unauthorized", { status: 401 });
  const { data: config, error: configError } = await supabase.rpc("get_notification_config");
  if (configError || !config)
    return new Response("Notification worker is not configured", { status: 503 });
  // Custom worker authentication: a user JWT or publishable key cannot invoke delivery.
  if (!equalSecret(authorization.slice(7), config.worker_token))
    return new Response("Unauthorized", { status: 401 });
  webpush.setVapidDetails(config.vapid_subject, config.vapid_public_key, config.vapid_private_key);
  const { data: events, error } = await supabase.rpc("claim_notification_events", { p_limit: 5 });
  if (error)
    return Response.json({ ok: false, error: "Could not claim notifications" }, { status: 500 });
  const deadline = Date.now() + 40_000;
  let delivered = 0;
  let failed = 0;
  for (const event of events ?? []) {
    const checkpoint = async (patch: Record<string, unknown>) => {
      const { data, error: updateError } = await supabase
        .from("notification_events")
        .update(patch)
        .eq("id", event.id)
        .eq("user_id", event.user_id)
        .eq("lease_token", event.lease_token)
        .select("id")
        .maybeSingle();
      if (updateError || !data) throw new Error("Notification lease was lost");
    };
    try {
      const { data: prefs, error: prefError } = await supabase
        .from("user_preferences")
        .select("notifications")
        .eq("id", event.user_id)
        .maybeSingle();
      if (prefError) throw new Error("Could not read notification preferences");
      const notifications = prefs?.notifications ?? {};
      if (!notificationEnabled(notifications, event.notification_type)) {
        await checkpoint({
          status: "skipped",
          last_error: "Disabled in preferences",
          lease_token: null,
          leased_until: null,
        });
        continue;
      }
      const now = new Date();
      const allowedAt = nextAllowedNotificationAt(now, notifications);
      if (!allowedAt || Date.parse(allowedAt) > now.getTime() || Date.now() >= deadline) {
        await checkpoint({
          available_at:
            allowedAt && Date.parse(allowedAt) > now.getTime()
              ? allowedAt
              : new Date(Date.now() + (!allowedAt ? 86_400_000 : 60_000)).toISOString(),
          attempt_count: Math.max(0, event.attempt_count - 1),
          lease_token: null,
          leased_until: null,
          last_error: allowedAt ? null : "Schedule and quiet hours have no allowed delivery window",
        });
        continue;
      }
      const { data: subscriptions, error: subError } = await supabase
        .from("push_subscriptions")
        .select("id,endpoint,p256dh,auth")
        .eq("user_id", event.user_id)
        .eq("disabled", false);
      if (subError) throw new Error("Could not read subscriptions");
      if (!subscriptions?.length) {
        await checkpoint({
          status: "skipped",
          last_error: "No active push subscription",
          lease_token: null,
          leased_until: null,
        });
        continue;
      }
      const sentIds = new Set<string>(event.delivered_subscription_ids ?? []);
      let retryNeeded = false;
      for (const subscription of subscriptions) {
        if (sentIds.has(subscription.id)) continue;
        if (Date.now() >= deadline) {
          retryNeeded = true;
          break;
        }
        try {
          await webpush.sendNotification(
            {
              endpoint: subscription.endpoint,
              keys: { p256dh: subscription.p256dh, auth: subscription.auth },
            },
            JSON.stringify({
              title: event.title,
              body: event.body,
              ...(event.payload ?? {}),
              tag: event.event_key,
            }),
            { TTL: 86400, timeout: 8000 },
          );
        } catch (pushError: any) {
          const gone = pushError?.statusCode === 404 || pushError?.statusCode === 410;
          const { error: subscriptionError } = await supabase
            .from("push_subscriptions")
            .update({
              disabled: gone,
              last_error: gone ? "Subscription expired" : "Push delivery failed",
            })
            .eq("id", subscription.id)
            .eq("user_id", event.user_id);
          if (subscriptionError) throw new Error("Could not record subscription failure");
          retryNeeded ||= !gone;
          continue;
        }
        // Persist each successful endpoint so retrying the event doesn't resend to it.
        sentIds.add(subscription.id);
        await checkpoint({ delivered_subscription_ids: [...sentIds] });
        const { error: successError } = await supabase
          .from("push_subscriptions")
          .update({
            last_success_at: new Date().toISOString(),
            last_error: null,
          })
          .eq("id", subscription.id)
          .eq("user_id", event.user_id);
        if (successError) throw new Error("Could not record delivery");
      }
      const status = retryNeeded
        ? event.attempt_count >= 6
          ? "failed"
          : "pending"
        : sentIds.size
          ? "sent"
          : "skipped";
      await checkpoint({
        status,
        sent_at: status === "sent" ? new Date().toISOString() : null,
        available_at: new Date(
          Date.now() + Math.min(60, 2 ** event.attempt_count) * 60_000,
        ).toISOString(),
        last_error: retryNeeded ? "Some subscriptions could not be reached" : null,
        lease_token: null,
        leased_until: null,
      });
      if (status === "sent") delivered++;
      if (status === "failed") failed++;
    } catch {
      failed++;
      // Keep all successful checkpoints; a bounded retry resumes remaining subscriptions.
      await checkpoint({
        status: event.attempt_count >= 6 ? "failed" : "pending",
        available_at: new Date(Date.now() + 5 * 60_000).toISOString(),
        last_error: "Delivery interrupted; retry scheduled",
        lease_token: null,
        leased_until: null,
      }).catch(() => {});
    }
  }
  return Response.json({ ok: true, checked: events?.length ?? 0, delivered, failed });
});
