import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { dashboardTiming } from "./dashboard-timing.server";
export type { DashboardCoreData, DashboardSummaryData } from "./dashboard-model";

export const getDashboardCore = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { readDashboardCore } = await import("./dashboard.server");
    return readDashboardCore(context.supabase, context.userId);
  });
export const getDashboardSummary = createServerFn({ method: "GET" })
  .middleware([dashboardTiming, requireSupabaseAuth])
  .validator((raw: unknown) => z.object({ weekStart: z.string().datetime() }).parse(raw))
  .handler(async ({ context, data }) => {
    const timer = context.dashboardTimer;
    timer?.mark("auth_setup");
    const load = () => import("./dashboard.server");
    const { readDashboardSummary } = timer
      ? await timer.measure("module_load", load)
      : await load();
    return readDashboardSummary(context.supabase, context.userId, data.weekStart, timer);
  });
