import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
export type { DashboardCoreData, DashboardSummaryData } from "./dashboard-model";

export const getDashboardCore = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { readDashboardCore } = await import("./dashboard.server");
    return readDashboardCore(context.supabase, context.userId);
  });
export const getDashboardSummary = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((raw: unknown) => z.object({ weekStart: z.string().datetime() }).parse(raw))
  .handler(async ({ context, data }) => {
    const { readDashboardSummary } = await import("./dashboard.server");
    return readDashboardSummary(context.supabase, context.userId, data.weekStart);
  });
