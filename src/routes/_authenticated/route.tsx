import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { getOnboardingStatus } from "@/lib/matches.functions";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async ({ location, context }) => {
    // This client guard only controls navigation; server functions still verify JWTs and RLS.
    const { data, error } = await supabase.auth.getSession();
    const user = data.session?.user;
    if (error || !user) throw redirect({ to: "/auth" });

    if (location.pathname !== "/onboarding") {
      const status = await context.queryClient.fetchQuery({
        queryKey: ["auth", "onboarding", user.id],
        queryFn: () => getOnboardingStatus(),
        staleTime: 5 * 60_000,
      });
      if (!status.onboarded) throw redirect({ to: "/onboarding" });
    }

    return { user };
  },
  component: () => <Outlet />,
});
