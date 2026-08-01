import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { Copy, Share2, Trophy, Users } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, LoadingState } from "@/components/layout/app-primitives";
import { getPublicProfile } from "@/lib/growth.functions";

export const Route = createFileRoute("/p/$handle")({
  head: ({ params }) => ({
    meta: [
      { title: `${params.handle} · ShuttleBoard` },
      { name: "description", content: "Public badminton player profile on ShuttleBoard." },
    ],
  }),
  component: PublicProfilePage,
});

function PublicProfilePage() {
  const { handle } = Route.useParams();
  const fetchProfile = useServerFn(getPublicProfile);
  const query = useQuery({
    queryKey: ["public-profile", handle],
    queryFn: () => fetchProfile({ data: { handle } }),
  });
  const link = typeof window === "undefined" ? `/p/${handle}` : window.location.href;

  async function share() {
    try {
      if (navigator.share) await navigator.share({ title: `${handle} · ShuttleBoard`, url: link });
      else {
        await navigator.clipboard?.writeText(link);
        toast.success("Profile link copied");
      }
    } catch {
      /* User cancelled the native share sheet. */
    }
  }

  if (query.isLoading) {
    return <LoadingState label="Loading profile" className="mx-auto min-h-[20rem] max-w-2xl" />;
  }

  if (query.isError || !query.data) {
    return (
      <ErrorState
        title="Profile not found"
        description="That ShuttleBoard profile does not exist."
        onRetry={() => void query.refetch()}
        className="mx-auto my-12 max-w-2xl"
      />
    );
  }

  if ("unavailable" in query.data) {
    return (
      <EmptyState
        title="Profile card unavailable"
        description={`@${query.data.handle} has not enabled public profile sharing.`}
        className="mx-auto my-12 max-w-2xl"
      />
    );
  }

  const { profile, stats } = query.data;
  return (
    <main className="mx-auto max-w-2xl px-5 py-12 sm:py-20">
      <section className="overflow-hidden rounded-3xl border border-primary/20 bg-card/70 shadow-2xl shadow-primary/5">
        <div className="h-28 bg-gradient-to-br from-primary/30 via-primary/5 to-background" />
        <div className="-mt-12 px-6 pb-7 sm:px-8">
          <div className="flex items-end justify-between gap-3">
            {profile.avatar_url?.startsWith("http") ? (
              <img
                src={profile.avatar_url}
                alt=""
                className="h-24 w-24 rounded-3xl border-4 border-card object-cover"
              />
            ) : (
              <div className="flex h-24 w-24 items-center justify-center rounded-3xl border-4 border-card bg-primary/15 text-3xl font-bold text-primary">
                {profile.display_name.slice(0, 1).toUpperCase()}
              </div>
            )}
            <Button type="button" onClick={share} variant="outline" size="sm">
              <Share2 className="h-3.5 w-3.5" /> Share
            </Button>
          </div>
          <h1 className="mt-5 font-display text-3xl font-bold">{profile.display_name}</h1>
          <p className="text-sm text-muted-foreground">@{profile.handle}</p>
          <div className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Matches" value={stats.matches} />
            <Stat label="Win rate" value={`${stats.winRate}%`} />
            <Stat label="Current streak" value={stats.currentStreak} />
            <Stat label="Wins" value={stats.wins} />
          </div>
          <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
            <span className="rounded-full border border-white/10 px-3 py-1.5">
              <Trophy className="mr-1 inline h-3.5 w-3.5 text-primary" /> {stats.wins} wins ·{" "}
              {stats.losses} losses
            </span>
            <span className="rounded-full border border-white/10 px-3 py-1.5">
              <Users className="mr-1 inline h-3.5 w-3.5 text-primary" /> {stats.singles} singles ·{" "}
              {stats.doubles} doubles
            </span>
          </div>
          <Button
            type="button"
            variant="link"
            size="sm"
            className="mt-5 px-0"
            onClick={() => {
              navigator.clipboard?.writeText(link);
              toast.success("Profile link copied");
            }}
          >
            <Copy className="h-3.5 w-3.5" /> Copy profile link
          </Button>
        </div>
      </section>
      <p className="mt-4 text-center text-[11px] text-muted-foreground">
        ShuttleBoard · Make every rally count.
      </p>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-background/40 p-3">
      <div className="text-xl font-bold text-foreground">{value}</div>
      <div className="mt-1 text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
    </div>
  );
}
