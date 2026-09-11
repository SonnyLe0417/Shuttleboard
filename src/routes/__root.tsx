import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";
import { Toaster } from "sonner";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { ThemeInit } from "../components/ThemeInit";
import { useSession } from "../hooks/useSession";
import { supabase } from "../integrations/supabase/client";
import { LoaderCircle, MoreHorizontal, Sparkles, UserRound } from "lucide-react";
import {
  TrackNetAnalysisProvider,
  useTrackNetAnalysis,
} from "@/components/TrackNetAnalysisProvider";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type MoreMenuItem = { label: string; to: string };

const MORE_MENU_GROUPS: Array<{ label: string; items: MoreMenuItem[] }> = [
  {
    label: "Coaching",
    items: [
      { label: "AI Referee", to: "/ai" },
      { label: "Video analysis", to: "/video" },
    ],
  },
  {
    label: "Learn",
    items: [
      { label: "Rules", to: "/rules" },
      { label: "USAB Juniors", to: "/junior-rankings" },
    ],
  },
  {
    label: "Community",
    items: [{ label: "Social", to: "/social" }],
  },
  {
    label: "Account",
    items: [
      { label: "Profile", to: "/profile" },
      { label: "Settings", to: "/settings" },
    ],
  },
];

function isPlayRoute(pathname: string) {
  return pathname === "/scoreboard" || pathname === "/match-lobby";
}

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="app-state w-full max-w-md border-solid bg-card/40 text-center">
        <p className="eyebrow text-primary">Court closed</p>
        <h1 className="app-page-title text-6xl">404</h1>
        <h2 className="app-state-title">Page not found</h2>
        <p className="app-state-description">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Button asChild>
            <Link to="/">Go home</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="button-primary"
          >
            Try again
          </button>
          <a href="/" className="button-secondary">
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Badminton Game Tracker" },
      {
        name: "description",
        content: "Track badminton score, serve side, and shuttle line calls with AI vision.",
      },
      { name: "author", content: "Lovable" },
      { property: "og:title", content: "Badminton Game Tracker" },
      {
        property: "og:description",
        content: "Track badminton score, serve side, and shuttle line calls with AI vision.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:site", content: "@Lovable" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: "/favicon.ico", type: "image/x-icon" },
      { rel: "manifest", href: "/manifest.webmanifest" },
      { rel: "apple-touch-icon", href: "/favicon.ico" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Sora:wght@500;600;700;800&family=Manrope:wght@400;500;600;700&display=swap",
      },
    ],
  }),

  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      <TrackNetAnalysisProvider>
        <RootContent />
      </TrackNetAnalysisProvider>
    </QueryClientProvider>
  );
}

function RootContent() {
  const { queryClient } = Route.useRouteContext();
  const router = useRouter();
  const pathname = router.state.location.pathname;
  const { user } = useSession();
  const { job, phase: trackNetPhase, progress, etaSeconds } = useTrackNetAnalysis();
  const showTrackNetProgress =
    job &&
    (trackNetPhase === "uploading" || trackNetPhase === "queued" || trackNetPhase === "processing");

  useEffect(() => {
    let previousUserId: string | null | undefined;
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      const nextUserId = session?.user.id ?? null;
      const changed = previousUserId !== undefined && previousUserId !== nextUserId;
      previousUserId = nextUserId;
      if (changed || event === "SIGNED_OUT") {
        queryClient.clear();
        queueMicrotask(() => void router.invalidate());
      } else if (event === "USER_UPDATED") {
        void queryClient.invalidateQueries({ queryKey: ["me", "profile"] });
        void queryClient.invalidateQueries({ queryKey: ["dashboard", "core"] });
      }
    });
    return () => sub.subscription.unsubscribe();
  }, [router, queryClient]);

  return (
    <div className="relative min-h-screen bg-background">
      {pathname !== "/" && (
        <nav
          className="site-nav nav-motion sticky top-0 z-50 border-b backdrop-blur-xl"
          aria-label="Primary navigation"
        >
          <div className="site-nav-inner mx-auto flex max-w-6xl items-center justify-between px-4">
            <Link
              to={user ? "/dashboard" : "/scoreboard"}
              className="site-brand group flex items-center gap-2.5"
            >
              <span
                className="animate-float inline-flex h-8 w-8 items-center justify-center rounded-xl text-[0px] text-primary-foreground shadow-[0_0_20px_oklch(0.82_0.17_165/0.45)] transition-transform duration-300 group-hover:scale-105"
                style={{ background: "var(--gradient-primary)" }}
                aria-hidden="true"
              >
                <Sparkles className="h-4 w-4" aria-hidden="true" />
              </span>
              <span className="site-brand-name font-display text-sm font-semibold tracking-tight text-foreground">
                Shuttle<span className="gradient-text-animated">Board</span>
              </span>
            </Link>
            <div className="flex min-w-0 items-center gap-2">
              <div className="site-nav-links flex items-center gap-0.5 rounded-full border border-white/5 bg-card/60 p-1">
                {user && <NavLink to="/dashboard">Home</NavLink>}
                <NavLink
                  to={user ? "/match-lobby" : "/scoreboard"}
                  forceActive={isPlayRoute(pathname)}
                >
                  Play
                </NavLink>
                {user && <NavLink to="/history">History</NavLink>}
                {user && <NavLink to="/progress">Progress</NavLink>}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className="site-nav-more inline-flex min-h-8 cursor-pointer items-center gap-1 rounded-full border-0 bg-transparent px-3.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      aria-label="More navigation options"
                    >
                      <span className="site-nav-more-label">More</span>
                      <MoreHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="end"
                    sideOffset={8}
                    className="w-52 rounded-xl border-white/10 bg-card/95 p-1.5 shadow-[var(--shadow-tile)] backdrop-blur-xl"
                  >
                    {MORE_MENU_GROUPS.map((group, groupIndex) => {
                      const items = group.items.filter(({ to }) => user || to === "/rules");
                      if (!items.length) return null;
                      return (
                        <div key={group.label}>
                          {groupIndex > 0 && <DropdownMenuSeparator className="bg-white/10" />}
                          <DropdownMenuLabel className="px-2 py-1 text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                            {group.label}
                          </DropdownMenuLabel>
                          {items.map((item) => (
                            <DropdownMenuItem
                              key={item.to}
                              asChild
                              className="rounded-lg px-2 py-1.5 text-xs text-foreground focus:bg-primary/10 focus:text-primary"
                            >
                              <Link to={item.to as any}>{item.label}</Link>
                            </DropdownMenuItem>
                          ))}
                        </div>
                      );
                    })}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              {user ? (
                <Link
                  to="/profile"
                  className="site-nav-profile flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-card/60 text-muted-foreground hover:text-foreground"
                  aria-label="Profile"
                >
                  {user.user_metadata?.avatar_url ? (
                    <img
                      src={user.user_metadata.avatar_url}
                      alt=""
                      className="h-8 w-8 rounded-full object-cover"
                    />
                  ) : (
                    <UserRound className="h-4 w-4" />
                  )}
                </Link>
              ) : (
                <Button asChild size="sm">
                  <Link to="/auth">Sign in</Link>
                </Button>
              )}
            </div>
          </div>
        </nav>
      )}
      {showTrackNetProgress && (
        <div className="sticky top-[57px] z-40 border-b border-primary/20 bg-primary/10 px-4 py-2 text-xs text-foreground backdrop-blur-xl">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <LoaderCircle className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" />
              <span className="truncate">
                TrackNet is analyzing {job.fileName} — {Math.round(progress * 100)}%
                {etaSeconds && etaSeconds > 0 ? ` · about ${formatEta(etaSeconds)} left` : ""}
              </span>
            </div>
            <Link to="/video" className="shrink-0 font-semibold text-primary hover:underline">
              View analyzer
            </Link>
          </div>
        </div>
      )}
      <ThemeInit />
      <main
        className={`relative z-10 mx-auto ${pathname === "/" ? "max-w-none px-0 py-0" : "max-w-6xl px-4 py-8"}`}
      >
        <div key={pathname} className="page-motion animate-fade-up stagger-children">
          <Outlet />
        </div>
      </main>
      <Toaster position="top-center" richColors theme="dark" />
    </div>
  );
}

function formatEta(seconds: number | null | undefined) {
  if (!seconds || !Number.isFinite(seconds) || seconds <= 0) return "soon";
  const rounded = Math.ceil(seconds);
  if (rounded < 60) return `${rounded}s`;
  const minutes = Math.floor(rounded / 60);
  const remainingSeconds = rounded % 60;
  return remainingSeconds ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
}

function NavLink({
  to,
  children,
  forceActive = false,
}: {
  to: string;
  children: React.ReactNode;
  forceActive?: boolean;
}) {
  return (
    <Link
      to={to}
      activeProps={{ className: "site-nav-link tab-active text-foreground" }}
      className={`site-nav-link relative rounded-full px-3.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground ${forceActive ? "tab-active text-foreground" : ""}`}
    >
      {children}
    </Link>
  );
}
