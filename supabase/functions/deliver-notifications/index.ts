import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "npm:web-push";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const vapidPublicKey = Deno.env.get("VAPID_PUBLIC_KEY");
const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY");
const vapidSubject = Deno.env.get("VAPID_SUBJECT") ?? "mailto:notifications@shuttleboard.app";
const supabase = createClient(supabaseUrl, serviceRoleKey);

if (vapidPublicKey && vapidPrivateKey) {
  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
}

Deno.serve(async () => {
  if (!vapidPublicKey || !vapidPrivateKey) {
    return Response.json({ ok: false, error: "VAPID keys are not configured" }, { status: 503 });
  }

  const { data: events, error: eventError } = await supabase
    .from("notification_events")
    .select("id, user_id, title, body, payload, attempt_count")
    .eq("status", "pending")
    .lte("available_at", new Date().toISOString())
    .order("available_at", { ascending: true })
    .limit(100);
  if (eventError) return Response.json({ ok: false, error: eventError.message }, { status: 500 });

  let delivered = 0;
  let failed = 0;
  for (const event of events ?? []) {
    const { data: subscriptions } = await supabase
      .from("push_subscriptions")
      .select("id, endpoint, p256dh, auth")
      .eq("user_id", event.user_id)
      .eq("disabled", false);

    let sent = 0;
    for (const subscription of subscriptions ?? []) {
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
          }),
          { TTL: 60 * 60 * 24 },
        );
        sent += 1;
        await supabase
          .from("push_subscriptions")
          .update({ last_success_at: new Date().toISOString(), last_error: null })
          .eq("id", subscription.id);
      } catch (error: any) {
        failed += 1;
        const status = error?.statusCode;
        await supabase
          .from("push_subscriptions")
          .update({
            disabled: status === 404 || status === 410,
            last_error: String(error?.body ?? error?.message ?? "Push failed").slice(0, 500),
          })
          .eq("id", subscription.id);
      }
    }

    if (sent > 0) {
      delivered += 1;
      await supabase
        .from("notification_events")
        .update({
          status: "sent",
          sent_at: new Date().toISOString(),
          attempt_count: (event.attempt_count ?? 0) + 1,
          last_error: null,
        })
        .eq("id", event.id);
    } else {
      await supabase
        .from("notification_events")
        .update({
          status: "pending",
          attempt_count: (event.attempt_count ?? 0) + 1,
          last_error: "No active push subscription",
        })
        .eq("id", event.id);
    }
  }

  return Response.json({ ok: true, delivered, failed, checked: events?.length ?? 0 });
});
