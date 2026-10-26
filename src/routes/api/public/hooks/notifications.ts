import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/hooks/notifications")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const token = /^Bearer ([^\s,]+)$/i.exec(request.headers.get("authorization") ?? "")?.[1];
        if (!token) return new Response("Unauthorized", { status: 401 });
        try {
          const { authorizeNotificationWorker } = await import("@/lib/notification-worker.server");
          const allowed = await authorizeNotificationWorker(token);
          if (allowed instanceof Response) return allowed;
          const job = new URL(request.url).searchParams.get("job") ?? "";
          if (!["reminders", "weekly", "inactivity"].includes(job))
            return new Response("Unknown job", { status: 400 });
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { runNotificationJob } = await import("@/lib/notification-jobs.server");
          return Response.json(await runNotificationJob(job, supabaseAdmin), {
            headers: { "cache-control": "no-store" },
          });
        } catch {
          return new Response("Notification queue unavailable", { status: 503 });
        }
      },
    },
  },
});
