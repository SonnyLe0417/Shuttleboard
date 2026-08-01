import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { Link2, Users } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { EmptyState, LoadingState } from "@/components/layout/app-primitives";
import { getInviteByToken, acceptInviteToken } from "@/lib/growth.functions";
import { useSession } from "@/hooks/useSession";

export const Route = createFileRoute("/invite/$token")({
  head: () => ({
    meta: [
      { title: "Match invitation · ShuttleBoard" },
      { name: "description", content: "Join a badminton match on ShuttleBoard." },
    ],
  }),
  component: InvitePage,
});

function InvitePage() {
  const { token } = Route.useParams();
  const router = useRouter();
  const { user } = useSession();
  const getInvite = useServerFn(getInviteByToken);
  const accept = useServerFn(acceptInviteToken);
  const query = useQuery({
    queryKey: ["invite", token],
    queryFn: () => getInvite({ data: { token } }),
  });

  if (query.isLoading) {
    return <LoadingState label="Loading invitation" className="mx-auto min-h-[20rem] max-w-lg" />;
  }

  if (query.isError || !query.data || query.data.unavailable) {
    return (
      <EmptyState
        title="Invitation unavailable"
        description="This match link is expired, revoked, or already used."
        className="mx-auto my-12 max-w-lg"
      />
    );
  }

  const sender = query.data.sender?.display_name || query.data.sender?.handle || "A player";

  async function join() {
    try {
      await accept({ data: { token } });
      toast.success("You joined the match");
      router.navigate({ to: "/scoreboard" });
    } catch (err: any) {
      toast.error(err.message ?? "Could not accept invitation");
    }
  }

  return (
    <main className="mx-auto max-w-lg px-5 py-12 sm:py-20">
      <section className="bento-tile p-7 text-center sm:p-9">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/15 text-primary">
          <Users className="h-7 w-7" />
        </div>
        <p className="eyebrow mt-5">
          <Link2 className="h-3.5 w-3.5" /> Match invitation
        </p>
        <h1 className="mt-3 font-display text-3xl font-bold">Join {sender} on court.</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          You’ve been invited to join team {query.data.team_side} in a ShuttleBoard match.
        </p>
        {user ? (
          <Button type="button" onClick={join} className="mt-7 w-full">
            Accept invitation
          </Button>
        ) : (
          <Button asChild className="mt-7 w-full">
            <Link
              to="/auth"
              onClick={() => window.localStorage.setItem("shuttleboard.pending-invite", token)}
            >
              Sign in to accept
            </Link>
          </Button>
        )}
      </section>
    </main>
  );
}
