import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in · ShuttleBoard" },
      { name: "description", content: "Sign in to save matches and track head-to-head history." },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup" | "forgot">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmationSent, setConfirmationSent] = useState(false);
  const [confirmationEmail, setConfirmationEmail] = useState("");

  useEffect(() => {
    const referral = new URLSearchParams(window.location.search).get("ref");
    if (referral) window.localStorage.setItem("shuttleboard.referral", referral);
    const continuePath = () => {
      const invite = window.localStorage.getItem("shuttleboard.pending-invite");
      if (invite) {
        window.localStorage.removeItem("shuttleboard.pending-invite");
        return `/invite/${invite}` as const;
      }
      return "/dashboard" as const;
    };
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: continuePath() as any });
    });
    const { data: sub } = supabase.auth.onAuthStateChange((e, s) => {
      if (s && (e === "SIGNED_IN" || e === "INITIAL_SESSION")) {
        navigate({ to: continuePath() as any });
      }
    });
    return () => sub.subscription.unsubscribe();
  }, [navigate]);

  async function handleEmail(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/auth`,
            data: { display_name: displayName || email.split("@")[0] },
          },
        });
        if (error) throw error;
        setConfirmationEmail(email);
        setConfirmationSent(true);
        toast.success("Account created. Check your email if confirmation is required.");
      } else if (mode === "forgot") {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/reset-password`,
        });
        if (error) throw error;
        toast.success("Password reset email sent. Check your inbox.");
        setMode("signin");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        toast.success("Signed in");
      }
    } catch (err: any) {
      if (err?.code === "email_not_confirmed" || /email not confirmed/i.test(err?.message ?? "")) {
        setConfirmationEmail(email);
        setConfirmationSent(true);
      }
      toast.error(err.message ?? "Auth failed");
    } finally {
      setBusy(false);
    }
  }

  async function resendConfirmation() {
    const targetEmail = confirmationEmail || email;
    if (!targetEmail) {
      toast.error("Enter your email address first.");
      return;
    }

    setBusy(true);
    try {
      const { error } = await supabase.auth.resend({
        type: "signup",
        email: targetEmail,
        options: { emailRedirectTo: `${window.location.origin}/auth` },
      });
      if (error) throw error;
      toast.success("Confirmation email sent. Check your inbox and spam folder.");
    } catch (err: any) {
      toast.error(err.message ?? "Could not resend confirmation email");
    } finally {
      setBusy(false);
    }
  }

  async function handleGoogle() {
    setBusy(true);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          // Supabase returns to this route with the OAuth session in the URL;
          // the auth-state listener above then sends the user to History.
          redirectTo: `${window.location.origin}/auth`,
        },
      });
      if (error) throw error;
    } catch (err: any) {
      toast.error(err.message ?? "Google sign-in failed");
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-md space-y-6">
      <div className="text-center">
        <h1 className="font-display text-3xl font-bold">
          {mode === "signin"
            ? "Welcome back"
            : mode === "signup"
              ? "Create your account"
              : "Reset your password"}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {mode === "signin"
            ? "Sign in to save matches and see your head-to-head."
            : mode === "signup"
              ? "Save match history, profiles, and rivalries."
              : "Enter your email and we'll send you a reset link."}
        </p>
      </div>

      <div className="rounded-2xl border border-white/10 bg-card/60 p-6 shadow-lg backdrop-blur">
        {mode !== "forgot" && (
          <>
            <button
              type="button"
              onClick={handleGoogle}
              disabled={busy}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-white/10 bg-background px-4 py-2.5 text-sm font-medium transition hover:bg-accent disabled:opacity-50"
            >
              <GoogleIcon />
              Continue with Google
            </button>

            <div className="my-5 flex items-center gap-3 text-xs text-muted-foreground">
              <div className="h-px flex-1 bg-white/10" />
              <span>or email</span>
              <div className="h-px flex-1 bg-white/10" />
            </div>
          </>
        )}

        <form onSubmit={handleEmail} className="space-y-3">
          {mode === "signup" && (
            <input
              type="text"
              placeholder="Display name"
              aria-label="Display name"
              autoComplete="name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="w-full rounded-lg border border-white/10 bg-background px-3 py-2 text-sm outline-none focus:border-primary"
            />
          )}
          <input
            type="email"
            required
            placeholder="you@example.com"
            aria-label="Email address"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-lg border border-white/10 bg-background px-3 py-2 text-sm outline-none focus:border-primary"
          />
          {mode !== "forgot" && (
            <input
              type="password"
              required
              minLength={6}
              placeholder="Password"
              aria-label="Password"
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-white/10 bg-background px-3 py-2 text-sm outline-none focus:border-primary"
            />
          )}
          <button
            type="submit"
            disabled={busy}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {mode === "signin"
              ? "Sign in"
              : mode === "signup"
                ? "Create account"
                : "Send reset link"}
          </button>
        </form>

        {confirmationSent && (
          <div className="mt-4 rounded-lg border border-amber-400/30 bg-amber-400/10 p-3 text-sm">
            <p className="text-foreground">
              Your email is not confirmed yet. Open the confirmation link in your email before
              signing in.
            </p>
            <button
              type="button"
              onClick={resendConfirmation}
              disabled={busy}
              className="mt-2 text-xs font-semibold text-primary hover:underline disabled:opacity-50"
            >
              Resend confirmation email
            </button>
          </div>
        )}

        {mode === "signin" && (
          <button
            type="button"
            onClick={() => setMode("forgot")}
            className="mt-3 w-full text-center text-xs text-muted-foreground hover:text-foreground"
          >
            Forgot your password?
          </button>
        )}

        <button
          type="button"
          onClick={() =>
            setMode(mode === "signin" ? "signup" : mode === "signup" ? "signin" : "signin")
          }
          className="mt-3 w-full text-center text-xs text-muted-foreground hover:text-foreground"
        >
          {mode === "signin"
            ? "No account? Create one"
            : mode === "signup"
              ? "Already have an account? Sign in"
              : "Back to sign in"}
        </button>
      </div>

      <div className="text-center text-xs text-muted-foreground">
        <Link to="/scoreboard" className="hover:text-foreground">
          ← Back to scoreboard
        </Link>
      </div>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden>
      <path
        fill="#FFC107"
        d="M43.6 20.5H42V20H24v8h11.3C33.7 32.6 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.4 6.1 29.5 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.2-.1-2.3-.4-3.5z"
      />
      <path
        fill="#FF3D00"
        d="M6.3 14.7l6.6 4.8C14.7 16 19 13 24 13c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.4 6.1 29.5 4 24 4c-7.7 0-14.3 4.4-17.7 10.7z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.4 0 10.2-2 13.8-5.3l-6.4-5.4C29.3 34.8 26.8 36 24 36c-5.3 0-9.7-3.4-11.3-8l-6.5 5C9.6 39.6 16.2 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.3-4.2 5.7l6.4 5.4C41 34.9 44 30 44 24c0-1.2-.1-2.3-.4-3.5z"
      />
    </svg>
  );
}
