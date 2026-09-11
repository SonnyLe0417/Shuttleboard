import { randomBytes } from "node:crypto";
import webpush from "web-push";
import { createClient } from "@supabase/supabase-js";

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const { data: existing, error } = await db.rpc("get_notification_config");
if (error) throw new Error(error.message);
if (existing) {
  console.log("Notification configuration already exists; keys preserved.");
} else {
  const { count, error: subError } = await db
    .from("push_subscriptions")
    .select("id", { count: "exact", head: true })
    .eq("disabled", false);
  if (subError) throw new Error(subError.message);
  if (count > 0 && !process.env.VAPID_PRIVATE_KEY)
    throw new Error("Existing subscriptions require the original VAPID key; no keys changed.");
  const keys =
    process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY
      ? { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY }
      : webpush.generateVAPIDKeys();
  const { error: writeError } = await db.rpc("initialize_notification_config", {
    p_project_url: process.env.SUPABASE_URL,
    p_worker_token: randomBytes(32).toString("hex"),
    p_vapid_public_key: keys.publicKey,
    p_vapid_private_key: keys.privateKey,
    p_vapid_subject: process.env.VAPID_SUBJECT ?? "mailto:notifications@shuttleboard.app",
  });
  if (writeError) throw new Error(writeError.message);
  console.log(
    "Notification credentials initialized in the server-only database schema. No secrets printed.",
  );
}
