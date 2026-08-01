import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { getOnboardingStatus } from "@/lib/matches.functions";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async ({ location }) => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });

    if (location.pathname !== "/onboarding") {
      const status = await getOnboardingStatus();
      if (!status.onboarded) throw redirect({ to: "/onboarding" });
    }

    return { user: data.user };
  },
  component: () => <Outlet />,
});
