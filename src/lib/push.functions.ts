import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const subInput = z.object({
  endpoint: z.string().url(),
  p256dh: z.string().min(1),
  auth: z.string().min(1),
  user_agent: z.string().max(300).optional(),
});

export const getPushPublicKey = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { getPushConfig } = await import("@/lib/push-config.server");
    const config = await getPushConfig();
    return { publicKey: config.publicKey };
  });

export const subscribePush = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((raw: unknown) => subInput.parse(raw))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase.from("push_subscriptions").upsert(
      {
        user_id: userId,
        endpoint: data.endpoint,
        p256dh: data.p256dh,
        auth: data.auth,
        user_agent: data.user_agent ?? null,
        disabled: false,
        last_error: null,
      },
      { onConflict: "endpoint" },
    );
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

export const unsubscribePush = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((raw: unknown) => z.object({ endpoint: z.string().url() }).parse(raw))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await supabase
      .from("push_subscriptions")
      .delete()
      .eq("user_id", userId)
      .eq("endpoint", data.endpoint);
    return { ok: true as const };
  });

export const sendTestPush = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { sendToUser } = await import("@/lib/push.server");
    const result = await sendToUser(supabaseAdmin, userId, {
      title: "ShuttleBoard test",
      body: "Push notifications are working. See you on court!",
      url: "/",
      tag: "test",
    });
    if (result.sent === 0)
      throw new Error("No push was delivered. Enable notifications on this device and try again.");
    return result;
  });
