import { createMiddleware } from "@tanstack/react-start";
import { setResponseHeader } from "@tanstack/react-start/server";
import { dashboardTimer } from "./dashboard-timing";

export const dashboardTiming = createMiddleware({ type: "function" }).server(async ({ next }) => {
  const timer = import.meta.env.DEV ? dashboardTimer() : undefined;
  try {
    return await next({ context: { dashboardTimer: timer } });
  } finally {
    if (timer) {
      timer.mark("total");
      setResponseHeader("Server-Timing", timer.header());
    }
  }
});
