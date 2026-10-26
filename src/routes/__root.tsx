import { useOfflineAccount, localOfflineAccess, offlineAuthChanged } from "@/lib/offline-account";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  useLocation,
  ClientOnly,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { lazy, Suspense, useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { ThemeInit } from "../components/ThemeInit";
import { useSession } from "../hooks/useSession";
import { loadBrowserSupabase } from "../lib/browser-supabase";
import { deferredSubscription } from "../lib/deferred-subscription";
import { LoaderCircle } from "lucide-react";
import { SessionRecovery } from "../components/SessionRecovery";
import {
  TrackNetAnalysisProvider,
  useTrackNetAnalysis,
} from "@/components/TrackNetAnalysisProvider";

const ClubNavigation = lazy(() => import("@/components/layout/ClubNavigation"));
const AppToaster = lazy(() => import("@/components/layout/AppToaster"));

function TrackNetProgressBanner() {
  const { job, phase: trackNetPhase, progress, etaSeconds } = useTrackNetAnalysis();
  const showTrackNetProgress =
    job &&
    (trackNetPhase === "uploading" || trackNetPhase === "queued" || trackNetPhase === "processing");
  return (
    <>
      {showTrackNetProgress && (
        <div className="club-job-banner sticky top-0 z-40 border-b border-primary/20 bg-primary/10 px-4 py-2 text-xs text-foreground backdrop-blur-xl">
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
    </>
  );
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
          <Link to="/" className="button-primary">
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  const { error: sessionError } = useSession();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  if (error.name === "SessionLoadError" || sessionError) return <SessionRecovery />;

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
      { title: "ShuttleBoard — Badminton Scores & Video Analysis" },
      {
        name: "description",
        content: "Track badminton score, serve side, and shuttle line calls with AI vision.",
      },
      { name: "author", content: "Lovable" },
      { property: "og:title", content: "ShuttleBoard — Badminton Scores & Video Analysis" },
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
      { rel: "icon", href: "/shuttleboard-icon.svg", type: "image/svg+xml" },
      { rel: "manifest", href: "/manifest.webmanifest" },
      { rel: "apple-touch-icon", href: "/favicon.ico" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&display=swap",
      },
    ],
  }),

  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  // The static offline document already provides its own html/head/body.
  if (typeof document !== "undefined" && document.getElementById("offline-root"))
    return <>{children}</>;
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
  const { pathname } = useLocation();
  const { user, error: sessionError } = useSession();
  const offline = useOfflineAccount();
  const localScoreboard = pathname === "/scoreboard" && localOfflineAccess(offline.account);
  const publicContent = pathname === "/" || pathname === "/rules" || pathname.startsWith("/p/");

  useEffect(() => {
    let previousUserId: string | null | undefined;
    return deferredSubscription(
      loadBrowserSupabase(),
      (supabase) => {
        const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
          const nextUserId = session?.user.id ?? null;
          queueMicrotask(() => void offlineAuthChanged(event, nextUserId).catch(() => {}));
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
      },
      (error) => reportLovableError(error, { boundary: "auth_subscription" }),
    );
  }, [router, queryClient]);

  return (
    <div
      className={`club-app relative min-h-screen bg-background ${pathname === "/" ? "club-public" : "club-interior"}`}
    >
      <a className="club-skip-link" href="#main-content">
        Skip to content
      </a>
      {pathname !== "/" && (
        <Suspense fallback={<div className="club-nav-loading" />}>
          <ClubNavigation signedIn={Boolean(user)} />
        </Suspense>
      )}
      <TrackNetProgressBanner />
      <ThemeInit />
      <main id="main-content" className={pathname === "/" ? "club-public-content" : "club-content"}>
        {sessionError && publicContent && <SessionRecovery inline />}
        <div className="club-route">
          {sessionError && !publicContent && !localScoreboard ? (
            <SessionRecovery />
          ) : publicContent ? (
            <Outlet />
          ) : (
            <ClientOnly
              fallback={
                <div className="app-state" role="status">
                  Loading your court…
                </div>
              }
            >
              <Outlet />
            </ClientOnly>
          )}
        </div>
      </main>
      <Suspense fallback={null}>
        <AppToaster />
      </Suspense>
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
